/**
 * AI Engine Facade Providers
 * Facade 依赖注入配置
 *
 * 将多个服务分组为 Feature 模块，简化 Facade 的构造函数
 */

import { Logger, Provider } from "@nestjs/common";
import { ShortTermMemoryService } from "../../ai-harness/memory/stores/short-term-memory.service";
import { LongTermMemoryService } from "../../ai-harness/memory/stores/long-term-memory.service";
import { ToolRegistry } from "../../ai-engine/tools/registry/tool.registry";
import { ToolPipeline } from "../../ai-engine/tools/middleware/tool-pipeline";
import { FunctionCallingExecutor } from "../../ai-harness/runner/executor/function-calling-executor";
import { FunctionCallingLLMAdapter } from "../../ai-engine/llm/adapters/function-calling-llm.adapter";
import { EntityHealthRegistry } from "../../ai-engine/reliability/entity-health/entity-health.registry";
import { AgentExecutorService } from "../runner/executor/agent-executor.service";
import { SkillLoaderService } from "../../ai-engine/skills/loader/loading/skill-loader.service";
import { SkillPromptBuilder } from "../../ai-engine/skills/builder/skill-prompt-builder.service";
// ★ P2 能力下沉：Realtime Feature 依赖
import { EventBusService as EngineEventEmitterService } from "../protocols/ipc/event-bus.service";
import { ProgressTrackerService } from "../protocols/ipc/progress-tracker.service";
// â˜… Constraint Feature ä¾èµ–
import { RateLimitService } from "../../ai-engine/reliability/rate-limit/rate-limit.service";
import { CostController } from "../guardrails/resources/cost-controller";
// ★ Orchestration 扩展依赖
// TaskDecomposerService 已删 (2026-04-30)
import { IntentDetectionService } from "../../ai-engine/planning/intent/intent-detection.service";
import { ProcessSupervisorService as ExecutionStateManager } from "../lifecycle/supervisor/process-supervisor.service";
import { OutputReviewerService } from "../evaluation/critique/output-reviewer.service";
import { ContextEvolutionService } from "../../ai-engine/knowledge/extraction/context-evolution.service";
import { QueryLoopService } from "../../ai-harness/runner/executor/query-loop.service";
import { TokenTrackerService } from "../../ai-harness/runner/executor/token-tracker.service";
// ★ Skill 扩展依赖
import { AiChatLLMAdapter } from "../../ai-engine/llm/adapters/ai-chat-llm.adapter";
import { InputBindingResolver } from "../../ai-engine/skills/integration/binding/skill-input-binding-resolver.service";
import { SkillContentService } from "../../ai-engine/skills/content/skill-content.service";
import { PrismaService } from "../../../common/prisma/prisma.service";
// ★ Tool 扩展依赖
import { AICapabilityResolver } from "../../ai-harness/runner/capabilities/ai-capability-resolver.service";
// â˜… Teams Feature ä¾èµ–
import { TeamsService } from "../teams/services/teams.service";
import { TeamFactory } from "../teams/factory/team-factory";
import { ContextInitializationService } from "../../ai-engine/knowledge/world-building/context-initialization.service";
import { TeamsMissionOrchestrator as MissionOrchestrator } from "../teams/orchestrator/teams-mission-orchestrator";
// â˜… Content Feature ä¾èµ–
// â˜… Phase 3→Phase 7: replaced L4 type imports with L2 abstractions (audit E-1)
import type {
  ILongContentEngine,
  IContinuationProtocol,
} from "../../ai-engine/content/abstractions/content-engine.interface";
import { ContentFetchService } from "../../ai-engine/content/fetch/content-fetch.service";
// â˜… Knowledge Feature ä¾èµ–
import { EmbeddingService } from "@/modules/ai-engine/rag/embedding";
import { VectorService } from "@/modules/ai-engine/rag/vector";
// ★ Intelligence Feature 依赖 (IntentRouter 已删 2026-04-30)
import { ReflectionService } from "../../ai-engine/planning/reflection/reflection.service";
import { ContextCompressionService } from "../../ai-engine/planning/context/context-compression.service";
// â˜… Phase 3→Phase 7: replaced L4 type import with L2 abstraction (audit E-2)
import type { IReportSynthesisEngine } from "../../ai-engine/content/abstractions/content-engine.interface";
// â˜… Collaboration Feature ä¾èµ–
import { EvidenceManagerService } from "../../ai-engine/knowledge/evidence/services/evidence-manager.service";
import { VotingManager } from "../teams/collaboration/patterns/voting-pattern";
import { MessageBusService as A2AMessageBusService } from "../protocols/ipc/message-bus.service";
// â˜… Observability Feature ä¾èµ–
import { TraceCollectorService } from "../tracing/observability/trace-collector.service";
import { MemoryCoordinatorService } from "../../ai-harness/memory/coordinator/memory-coordinator.service";
// â˜… Registry Feature ä¾èµ–
import { PlanBasedAgentRegistry } from "../agents/registry/plan-based-agent-registry";
import { TeamRegistry } from "../teams/registry/team-registry";
import { RoleRegistry } from "../teams/registry/role-registry";
import { SkillRegistry } from "../../ai-engine/skills/registry/skill.registry";

// ============================================================================
// Feature Interfaces (re-export from facade)
// ============================================================================

/**
 * 记忆能力特性
 */
export interface MemoryFeature {
  shortTerm: ShortTermMemoryService;
  longTerm: LongTermMemoryService;
}

/**
 * 工具执行特性（含 AI 能力解析）
 */
export interface ToolFeature {
  registry: ToolRegistry;
  executor?: FunctionCallingExecutor;
  llmAdapter?: FunctionCallingLLMAdapter;
  capabilityResolver?: AICapabilityResolver;
}

/**
 * 编排能力特性（扩展：含任务分解、意图检测等）
 */
export interface OrchestrationFeature {
  circuitBreaker: EntityHealthRegistry;
  agentExecutor: AgentExecutorService;
  // taskDecomposer 已删 (2026-04-30)
  intentDetector?: IntentDetectionService;
  execStateManager?: ExecutionStateManager;
  outputReviewer?: OutputReviewerService;
  contextEvolution?: ContextEvolutionService;
  queryLoop?: QueryLoopService;
  tokenTracker?: TokenTrackerService;
}

/** Parameters for fire-and-forget skill usage logging */
export interface SkillUsageLogParams {
  skillIds: string[];
  success: boolean;
  duration: number;
  tokensUsed?: number;
  model?: string;
  domain?: string;
  userId?: string;
}

/**
 * 技能特性（扩展：含 LLM 适配器和输入绑定解析器）
 */
export interface SkillFeature {
  loader: SkillLoaderService;
  promptBuilder: SkillPromptBuilder;
  llmAdapter?: AiChatLLMAdapter;
  inputBindingResolver?: InputBindingResolver;
  /** 2026-05-01 (PR-X-R): 注入到实现 setToolPipeline() 的 skill 实例 */
  toolPipeline?: ToolPipeline;
  /** Fire-and-forget log skill usage for analytics dashboard */
  logUsage?: (params: SkillUsageLogParams) => void;
}

// ============================================================================
// ★ P2 能力下沉：Realtime Feature Interface
// ============================================================================

/**
 * 实时推送特性
 */
export interface RealtimeFeature {
  eventEmitter: EngineEventEmitterService;
  progressTracker: ProgressTrackerService;
}

// ============================================================================
// Constraint Feature Interface
// ============================================================================

/**
 * 约束控制特性
 */
export interface ConstraintFeature {
  rateLimiter: RateLimitService;
  costController: CostController;
}

// ============================================================================
// ★ Phase 2 新增 Feature Interfaces
// ============================================================================

/**
 * 团队协作特性
 */
export interface TeamsFeature {
  teamsService?: TeamsService;
  teamFactory?: TeamFactory;
  contextInit?: ContextInitializationService;
  missionOrchestrator?: MissionOrchestrator;
}

/**
 * 内容生产特性
 */
export interface ContentFeature {
  longContentEngine?: ILongContentEngine;
  continuationProtocol?: IContinuationProtocol;
  contentFetch?: ContentFetchService;
}

/**
 * 知识能力特性
 */
export interface KnowledgeFeature {
  embedding?: EmbeddingService;
  vector?: VectorService;
}

/**
 * 智能分析特性
 */
export interface IntelligenceFeature {
  reflection?: ReflectionService;
  contextCompression?: ContextCompressionService;
  synthesisEngine?: IReportSynthesisEngine;
}

/**
 * 协作能力特性
 */
export interface CollaborationFeature {
  evidenceManager?: EvidenceManagerService;
  votingManager?: VotingManager;
  a2aBus?: A2AMessageBusService;
}

/**
 * 可观测性特性
 */
export interface ObservabilityFeature {
  traceCollector?: TraceCollectorService;
  memoryCoordinator?: MemoryCoordinatorService;
}

/**
 * 注册表特性
 */
export interface RegistryFeature {
  agent?: PlanBasedAgentRegistry;
  team?: TeamRegistry;
  role?: RoleRegistry;
  skill?: SkillRegistry;
}

// ============================================================================
// Injection Tokens
// ============================================================================

export const MEMORY_FEATURE = "MEMORY_FEATURE";
export const TOOL_FEATURE = "TOOL_FEATURE";
export const ORCHESTRATION_FEATURE = "ORCHESTRATION_FEATURE";
export const SKILL_FEATURE = "SKILL_FEATURE";
// ★ P2 能力下沉：Realtime Injection Token
export const REALTIME_FEATURE = "REALTIME_FEATURE";
export const CONSTRAINT_FEATURE = "CONSTRAINT_FEATURE";
// ★ Phase 2 新增 Injection Token
export const TEAMS_FEATURE = "TEAMS_FEATURE";
export const CONTENT_FEATURE = "CONTENT_FEATURE";
export const KNOWLEDGE_FEATURE = "KNOWLEDGE_FEATURE";
export const INTELLIGENCE_FEATURE = "INTELLIGENCE_FEATURE";
export const COLLABORATION_FEATURE = "COLLABORATION_FEATURE";
export const OBSERVABILITY_FEATURE = "OBSERVABILITY_FEATURE";
export const REGISTRY_FEATURE = "REGISTRY_FEATURE";

// ============================================================================
// Factory Providers
// ============================================================================

/**
 * Memory Feature Provider
 * 聚合短期和长期记忆服务
 */
export const memoryFeatureProvider: Provider = {
  provide: MEMORY_FEATURE,
  useFactory: (
    shortTerm?: ShortTermMemoryService,
    longTerm?: LongTermMemoryService,
  ): MemoryFeature | undefined => {
    if (!shortTerm || !longTerm) return undefined;
    return { shortTerm, longTerm };
  },
  inject: [
    { token: ShortTermMemoryService, optional: true },
    { token: LongTermMemoryService, optional: true },
  ],
};

/**
 * Tool Feature Provider
 * 聚合工具注册表、执行器和能力解析器
 */
export const toolFeatureProvider: Provider = {
  provide: TOOL_FEATURE,
  useFactory: (
    registry?: ToolRegistry,
    executor?: FunctionCallingExecutor,
    llmAdapter?: FunctionCallingLLMAdapter,
    capabilityResolver?: AICapabilityResolver,
  ): ToolFeature | undefined => {
    if (!registry) return undefined;
    return { registry, executor, llmAdapter, capabilityResolver };
  },
  inject: [
    { token: ToolRegistry, optional: true },
    { token: FunctionCallingExecutor, optional: true },
    { token: FunctionCallingLLMAdapter, optional: true },
    { token: AICapabilityResolver, optional: true },
  ],
};

/**
 * Orchestration Feature Provider
 * 聚合熔断器、Agent 执行器及扩展编排服务
 */
export const orchestrationFeatureProvider: Provider = {
  provide: ORCHESTRATION_FEATURE,
  useFactory: (
    circuitBreaker?: EntityHealthRegistry,
    agentExecutor?: AgentExecutorService,
    intentDetector?: IntentDetectionService,
    execStateManager?: ExecutionStateManager,
    outputReviewer?: OutputReviewerService,
    contextEvolution?: ContextEvolutionService,
    queryLoop?: QueryLoopService,
    tokenTracker?: TokenTrackerService,
  ): OrchestrationFeature | undefined => {
    if (!circuitBreaker || !agentExecutor) return undefined;
    return {
      circuitBreaker,
      agentExecutor,
      intentDetector,
      execStateManager,
      outputReviewer,
      contextEvolution,
      queryLoop,
      tokenTracker,
    };
  },
  inject: [
    { token: EntityHealthRegistry, optional: true },
    { token: AgentExecutorService, optional: true },
    { token: IntentDetectionService, optional: true },
    { token: ExecutionStateManager, optional: true },
    { token: OutputReviewerService, optional: true },
    { token: ContextEvolutionService, optional: true },
    { token: QueryLoopService, optional: true },
    { token: TokenTrackerService, optional: true },
  ],
};

/**
 * Skill Feature Provider
 * 聚合技能加载器、提示词构建器及扩展服务
 */
export const skillFeatureProvider: Provider = {
  provide: SKILL_FEATURE,
  useFactory: (
    loader?: SkillLoaderService,
    promptBuilder?: SkillPromptBuilder,
    llmAdapter?: AiChatLLMAdapter,
    inputBindingResolver?: InputBindingResolver,
    prisma?: PrismaService,
    skillContentService?: SkillContentService,
    toolPipeline?: ToolPipeline,
  ): SkillFeature | undefined => {
    if (!loader || !promptBuilder) return undefined;

    // Create fire-and-forget skill usage logger for analytics
    const skillLogger = new Logger("SkillUsageLogger");
    const logUsage = prisma
      ? (params: SkillUsageLogParams): void => {
          const skillCount = params.skillIds.length;
          if (skillCount === 0) return;

          for (const skillId of params.skillIds) {
            // Distribute tokens evenly across used skills
            const tokensPerSkill = params.tokensUsed
              ? Math.ceil(params.tokensUsed / skillCount)
              : null;

            void prisma.aIUsageLog
              .create({
                data: {
                  capabilityType: "skill",
                  capabilityId: skillId,
                  success: params.success,
                  duration: params.duration,
                  tokensUsed: tokensPerSkill,
                  modelUsed: params.model ?? null,
                  domain: params.domain ?? null,
                  userId: params.userId ?? null,
                },
              })
              .catch((err: Error) =>
                skillLogger.debug(
                  `Skill usage log failed for "${skillId}": ${err.message}`,
                ),
              );

            // Update SkillConfig counter (lastUsedAt + usageCount)
            if (skillContentService) {
              void skillContentService.recordUsage(skillId);
            }
          }
        }
      : undefined;

    return {
      loader,
      promptBuilder,
      llmAdapter,
      inputBindingResolver,
      toolPipeline,
      logUsage,
    };
  },
  inject: [
    { token: SkillLoaderService, optional: true },
    { token: SkillPromptBuilder, optional: true },
    { token: AiChatLLMAdapter, optional: true },
    { token: InputBindingResolver, optional: true },
    { token: PrismaService, optional: true },
    { token: SkillContentService, optional: true },
    { token: ToolPipeline, optional: true },
  ],
};

// ============================================================================
// ★ P2 能力下沉：Realtime Feature Provider
// ============================================================================

/**
 * Realtime Feature Provider
 * 聚合事件发射和进度追踪服务
 */
export const realtimeFeatureProvider: Provider = {
  provide: REALTIME_FEATURE,
  useFactory: (
    eventEmitter?: EngineEventEmitterService,
    progressTracker?: ProgressTrackerService,
  ): RealtimeFeature | undefined => {
    if (!eventEmitter || !progressTracker) return undefined;
    return { eventEmitter, progressTracker };
  },
  inject: [
    { token: EngineEventEmitterService, optional: true },
    { token: ProgressTrackerService, optional: true },
  ],
};

// ============================================================================
// Constraint Feature Provider
// ============================================================================

/**
 * Constraint Feature Provider
 * 聚合速率限制器和成本控制器
 */
export const constraintFeatureProvider: Provider = {
  provide: CONSTRAINT_FEATURE,
  useFactory: (
    rateLimiter?: RateLimitService,
    costController?: CostController,
  ): ConstraintFeature | undefined => {
    if (!rateLimiter || !costController) return undefined;
    return { rateLimiter, costController };
  },
  inject: [
    { token: RateLimitService, optional: true },
    { token: CostController, optional: true },
  ],
};

// ============================================================================
// ★ Phase 2 新增 Feature Providers
// ============================================================================

export const teamsFeatureProvider: Provider = {
  provide: TEAMS_FEATURE,
  useFactory: (
    teamsService?: TeamsService,
    teamFactory?: TeamFactory,
    contextInit?: ContextInitializationService,
    missionOrchestrator?: MissionOrchestrator,
  ): TeamsFeature | undefined => {
    if (!teamsService) return undefined;
    return { teamsService, teamFactory, contextInit, missionOrchestrator };
  },
  inject: [
    { token: TeamsService, optional: true },
    { token: TeamFactory, optional: true },
    { token: ContextInitializationService, optional: true },
    { token: MissionOrchestrator, optional: true },
  ],
};

// â˜… String tokens for cross-layer DI (breaks circular dep: facade → content-engine → facade)
export const LONG_CONTENT_ENGINE_TOKEN = "LongContentEngineService";
export const CONTINUATION_PROTOCOL_TOKEN = "ContinuationProtocolService";
export const REPORT_SYNTHESIS_ENGINE_TOKEN = "ReportSynthesisEngine";

export const contentFeatureProvider: Provider = {
  provide: CONTENT_FEATURE,
  useFactory: (
    longContentEngine?: ILongContentEngine,
    continuationProtocol?: IContinuationProtocol,
    contentFetch?: ContentFetchService,
  ): ContentFeature | undefined => {
    if (!longContentEngine && !continuationProtocol && !contentFetch)
      return undefined;
    return { longContentEngine, continuationProtocol, contentFetch };
  },
  inject: [
    { token: LONG_CONTENT_ENGINE_TOKEN, optional: true },
    { token: CONTINUATION_PROTOCOL_TOKEN, optional: true },
    { token: ContentFetchService, optional: true },
  ],
};

export const knowledgeFeatureProvider: Provider = {
  provide: KNOWLEDGE_FEATURE,
  useFactory: (
    embedding?: EmbeddingService,
    vector?: VectorService,
  ): KnowledgeFeature | undefined => {
    if (!embedding && !vector) return undefined;
    return { embedding, vector };
  },
  inject: [
    { token: EmbeddingService, optional: true },
    { token: VectorService, optional: true },
  ],
};

export const intelligenceFeatureProvider: Provider = {
  provide: INTELLIGENCE_FEATURE,
  useFactory: (
    reflection?: ReflectionService,
    contextCompression?: ContextCompressionService,
    synthesisEngine?: IReportSynthesisEngine,
  ): IntelligenceFeature | undefined => {
    if (!reflection && !contextCompression && !synthesisEngine)
      return undefined;
    return { reflection, contextCompression, synthesisEngine };
  },
  inject: [
    { token: ReflectionService, optional: true },
    { token: ContextCompressionService, optional: true },
    { token: REPORT_SYNTHESIS_ENGINE_TOKEN, optional: true },
  ],
};

export const collaborationFeatureProvider: Provider = {
  provide: COLLABORATION_FEATURE,
  useFactory: (
    evidenceManager?: EvidenceManagerService,
    votingManager?: VotingManager,
    a2aBus?: A2AMessageBusService,
  ): CollaborationFeature | undefined => {
    if (!evidenceManager && !votingManager && !a2aBus) return undefined;
    return { evidenceManager, votingManager, a2aBus };
  },
  inject: [
    { token: EvidenceManagerService, optional: true },
    { token: VotingManager, optional: true },
    { token: A2AMessageBusService, optional: true },
  ],
};

export const observabilityFeatureProvider: Provider = {
  provide: OBSERVABILITY_FEATURE,
  useFactory: (
    traceCollector?: TraceCollectorService,
    memoryCoordinator?: MemoryCoordinatorService,
  ): ObservabilityFeature | undefined => {
    if (!traceCollector && !memoryCoordinator) return undefined;
    return { traceCollector, memoryCoordinator };
  },
  inject: [
    { token: TraceCollectorService, optional: true },
    { token: MemoryCoordinatorService, optional: true },
  ],
};

export const registryFeatureProvider: Provider = {
  provide: REGISTRY_FEATURE,
  useFactory: (
    agent?: PlanBasedAgentRegistry,
    team?: TeamRegistry,
    role?: RoleRegistry,
    skill?: SkillRegistry,
  ): RegistryFeature | undefined => {
    if (!agent && !team && !role && !skill) return undefined;
    return { agent, team, role, skill };
  },
  inject: [
    { token: PlanBasedAgentRegistry, optional: true },
    { token: TeamRegistry, optional: true },
    { token: RoleRegistry, optional: true },
    { token: SkillRegistry, optional: true },
  ],
};

// ============================================================================
// All Feature Providers
// ============================================================================

export const FACADE_FEATURE_PROVIDERS: Provider[] = [
  memoryFeatureProvider,
  toolFeatureProvider,
  orchestrationFeatureProvider,
  skillFeatureProvider,
  // ★ P2 能力下沉：Realtime Provider
  realtimeFeatureProvider,
  constraintFeatureProvider,
  // ★ Phase 2 新增 Providers
  teamsFeatureProvider,
  contentFeatureProvider,
  knowledgeFeatureProvider,
  intelligenceFeatureProvider,
  collaborationFeatureProvider,
  observabilityFeatureProvider,
  registryFeatureProvider,
];

// ============================================================================
// â˜… Phase 5: Domain Facade Providers
// Domain facades are @Injectable() NestJS providers that group related
// capabilities. The God Facade (AIFacade) delegates to them.
// Each facade is registered by its class token directly in AIEngineModule.
// ============================================================================
