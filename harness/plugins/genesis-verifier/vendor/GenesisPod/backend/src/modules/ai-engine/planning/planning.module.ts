/**
 * AI Engine Planning Module
 *
 * 提供与 agent 身份无关的规划基元：
 * - budget estimation
 * - context compression / compaction
 * - intent detection
 * - reflection
 */

import { Module, forwardRef } from "@nestjs/common";

// Registries (from other modules)
import { AiEngineToolsModule } from "../tools/tools.module";
import { AiEngineSkillsModule } from "../skills/skills.module";
import { AiEngineSafetyModule } from "../safety/safety.module";

// Executors —— 2026-04-30 (C2-step2) 删除 4 个死代码 (BaseExecutor / DAGExecutor /
// SequentialExecutor / ParallelExecutor)；DAG 业务实际用 ai-harness/runner/dag/
// 165行轻量版替代。保留 FunctionCallingExecutor (1340行 teams/ai-response 真用)

// Orchestration Services —— 2026-04-30 (C2-step2) 删除 3 个真死代码:
//   - IterationManagerService (in-memory store 但 0 调用)
//   - IntelligentModelRouterService ("支柱四"未接入)
//   - ComplexityAnalyzerService (仅被 IntelligentModelRouter 用 → 绑死)
// TaskDecomposerService 已删 (2026-04-30) — 死代码链路 (TaskBreakdown 0 注入)
// AgentExecutorService 已搬到 ai-harness/runner/executor/ (2026-04-30)
// OutputReviewerService 已搬到 ai-harness/evaluation/critique/ (2026-05-02)
// EntityHealthRegistry / RateLimitService 由 @Global AiEngineReliabilityModule 提供（W7）
import { ContextBudgetCalculator } from "./budget/token-budget.service";
import { ContextEvolutionService } from "../knowledge/extraction/context-evolution.service";
import { ContextInitializationService } from "../knowledge/world-building/context-initialization.service";
// PR-X18: ConstraintEnforcementService 通过 CONSTRAINT_ENFORCEMENT_PORT token 注入
import { ContextCompressionService } from "./context/context-compression.service";
import { IntentDetectionService } from "./intent/intent-detection.service";
import { ReflectionService } from "./reflection/reflection.service";
// ADR-009 (P1): role-agnostic step decomposition primitive
// Consumers: SelfDrivenMissionPlanner (harness/teams/orchestrator) + LeaderLLMAdapter.decomposeTask
import { StepDecompositionService } from "./decomposition/step-decomposition.service";
// IntentRouterService / TaskPlannerService 已删 (2026-04-30) — 死代码，前端 0 消费
// ★ Phase 1-4: 基础设施升级新增服务
import { ContextCompactionPipelineService } from "./context/context-compaction-pipeline.service";
// AdaptiveReplannerService 已搬到 ai-harness/teams/orchestrator/ (2026-04-30)
import { CrossCuttingSynthesisService } from "../knowledge/synthesis/cross-cutting-synthesis.service";
// ★ Phase 7: 会话记忆旁路
// ★ Phase 9 → 已搬到 ai-harness/memory/consolidation/（C2-step1，2026-04-30）
//   AutoDreamService / AutoDreamSchedulerService 不再由 engine 注册

// State Machine — PR-X18: 通过 EXECUTION_STATE_MANAGER_PORT token 注入

// Handlers —— 2026-04-30 (C2-step2) 删除（仅被 BaseExecutor 用，BaseExecutor 死）

// 2026-04-30 (C2-step2): 删除 sequentialExecutorFactory / dagExecutorFactory /
// parallelExecutorFactory —— 这 3 个 factory 包装的 executor 已删（0 业务调用），
// DAG 业务实际用 ai-harness/runner/dag/ 165行轻量版替代。
// FunctionCallingExecutor 不需 factory（直接 NestJS 注入）。

@Module({
  imports: [
    forwardRef(() => AiEngineToolsModule),
    forwardRef(() => AiEngineSkillsModule),
    forwardRef(() => AiEngineSafetyModule),
  ],
  controllers: [],
  providers: [
    // Executors —— 全部移出本模块。FunctionCallingExecutor 注册在 ai-harness
    // HarnessModule（它属于 ai-harness/runner/executor，依赖 ToolRegistry）。
    // 2026-05-21：此前这里只剩注释、HarnessModule 也漏注册 → DI 永远 undefined →
    // "Tool execution not available"，已在 HarnessModule providers 补回。

    // NOTE: harness 服务（ProgressTracker / TraceCollector / CheckpointManager
    // / CircuitBreaker / ConstraintEnforcement / ExecutionStateManager）come
    // from @Global() HarnessModule via DI tokens — engine 不直接 import

    // Engine Orchestration Services —— C2-step2 删除 IterationManager / ComplexityAnalyzer / IntelligentModelRouter
    ContextBudgetCalculator,
    ContextEvolutionService,
    ContextInitializationService,
    ContextCompressionService,
    IntentDetectionService,
    ReflectionService,
    // ★ Phase 1-4: 基础设施升级
    ContextCompactionPipelineService,
    // ★ Phase 10: Coordinator Synthesize-Before-Delegate
    CrossCuttingSynthesisService,
    // ★ Phase 7: Session Memory Sidecar
    // ADR-009 (P1): role-agnostic step decomposition primitive
    StepDecompositionService,
  ],
  exports: [
    // Executors

    // Engine Services
    ContextBudgetCalculator,
    ContextEvolutionService,
    ContextInitializationService,
    ContextCompressionService,
    IntentDetectionService,
    ReflectionService,
    // ★ Phase 1-4: 基础设施升级
    ContextCompactionPipelineService,
    // ★ Phase 10: Coordinator Synthesize-Before-Delegate
    CrossCuttingSynthesisService,
    // ★ Phase 7: Session Memory Sidecar
    // ADR-009 (P1): role-agnostic step decomposition primitive
    StepDecompositionService,
  ],
})
export class AiEnginePlanningModule {}
