/**
 * AI Engine - Teams Module
 * 团队系统 NestJS 模块
 *
 * 集成到 AI Engine 核心模块，依赖：
 * - ToolRegistry: 工具注册表
 * - SkillRegistry: 技能注册表
 * - LLMFactory: LLM 适配器工厂
 * - CostController: 成本控制器
 * - Memory: 记忆系统
 * - MCPManager: MCP 外部工具管理
 */

import { Module, OnModuleInit, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { RoleRegistry } from "./registry/role-registry";
import { TeamRegistry } from "./registry/team-registry";
// ★ 2026-06-07: MissionPipelineRegistry 提升为 @Global 平台 registry（与 ToolRegistry/
//   TeamRegistry 对齐，"一概念一注册表"）。各 ai-app 不再 local-provide，统一注册进此单例，
//   company 市场目录据此投影所有 mission 工作流。详见标准 28 + design.md §11。
import { MissionPipelineRegistry } from "./orchestrator/pipeline/mission-pipeline-registry.service";
// ★ L2 internal — direct relative paths (禁 facade barrel)
import { ConstraintEngine } from "@/modules/ai-harness/guardrails/constraints/constraint-engine";
import { TeamsMissionOrchestrator as MissionOrchestrator } from "./orchestrator/teams-mission-orchestrator";
import { MissionRuntimeStateStore } from "../lifecycle/mission-lifecycle/runtime-state-store";
import { MissionLivenessGuard } from "../lifecycle/mission-lifecycle/mission-liveness-guard.service";
import { MissionOwnershipRegistry } from "../lifecycle/mission-lifecycle/ownership-registry";
import { RerunLockRegistry } from "../lifecycle/mission-lifecycle/rerun-lock.registry";
import { AdaptiveReplannerService } from "./orchestrator/adaptive-replanner.service";
import { TeamFactory } from "./factory/team-factory";
import { TeamsService } from "./services/teams.service";
import { MessageBusService as A2AMessageBusService } from "@/modules/ai-harness/protocols/ipc/message-bus.service";
// PR-X16: TeamsController 已迁移至 open-api/teams（HTTP Controller 上提）

// AI Engine 核心依赖
import { ToolRegistry } from "@/modules/ai-engine/tools/registry/tool.registry";
import { ToolPipeline } from "@/modules/ai-engine/tools/middleware/tool-pipeline";
import { SkillRegistry } from "@/modules/ai-engine/skills/registry/skill.registry";
import { LLMFactory } from "@/modules/ai-engine/llm/factory/llm.factory";
import { CostController } from "@/modules/ai-harness/guardrails/resources/cost-controller";
import { ShortTermMemoryService } from "@/modules/ai-harness/memory/stores/short-term-memory.service";
import { MCPManager } from "@/modules/ai-engine/tools/adapters/mcp/manager/mcp-manager";
import { AiChatService } from "@/modules/ai-engine/llm/chat/ai-chat.service";
import { StepDecompositionService } from "@/modules/ai-engine/planning/decomposition/step-decomposition.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { TraceCollectorService } from "@/modules/ai-harness/tracing/observability/trace-collector.service";
import { CheckpointManager } from "@/modules/ai-harness/protocols/journal/checkpoint-manager";
import { MissionExecutorService } from "@/modules/ai-harness/lifecycle/manager/mission-executor.service";
import { EventJournalService } from "@/modules/ai-harness/protocols/journal/event-journal.service";

/**
 * Teams 模块
 *
 * 提供完整的团队协作能力：
 * - Role 管理（预定义角色）
 * - Team 管理（预定义和自定义团队）
 * - Constraint 约束引擎（集成 CostController）
 * - Mission 编排器（集成 LLM/Tools/Skills/Memory）
 */
@Module({
  controllers: [], // TeamsController moved to open-api/teams (PR-X16)
  providers: [
    RoleRegistry,
    TeamRegistry,
    // ★ @Global mission pipeline registry（替代 4 个 ai-app 各自 local-provide）
    MissionPipelineRegistry,
    A2AMessageBusService,
    // ★ Phase 9 (2026-04-30): Mission 运行时状态外置 → Redis（CacheService global）
    MissionRuntimeStateStore,
    // ★ 2026-05-05 unified harness liveness guard（多信号 + adapter 注入 + 多 namespace）
    //   ai-app 通过 onModuleInit 调 livenessGuard.registerAdapter('namespace', adapter)
    //   归并/替代旧 4 个 detector（含已删除的 MissionOrphanDetectorService）
    MissionLivenessGuard,
    // ★ MissionAbortRegistry 已上提至 @Global HarnessModule（2026-05-08 PR-E0 fix），由全局 DI 注入
    MissionOwnershipRegistry,
    RerunLockRegistry,
    // ★ 2026-04-30: AdaptiveReplannerService 从 ai-engine/planning 搬来 (跨层搬迁)
    AdaptiveReplannerService,
    // ConstraintEngine ä¾èµ– CostController
    {
      provide: ConstraintEngine,
      useFactory: (costController: CostController) => {
        return new ConstraintEngine(costController);
      },
      inject: [CostController],
    },
    // TeamFactory 依赖 RoleRegistry、TeamRegistry、LLMFactory 和 StepDecompositionService（ADR-009）
    {
      provide: TeamFactory,
      useFactory: (
        roleRegistry: RoleRegistry,
        teamRegistry: TeamRegistry,
        llmFactory: LLMFactory,
        stepDecomposition: StepDecompositionService,
      ) => {
        return new TeamFactory(
          roleRegistry,
          teamRegistry,
          llmFactory,
          stepDecomposition,
        );
      },
      inject: [
        RoleRegistry,
        TeamRegistry,
        LLMFactory,
        StepDecompositionService,
      ],
    },
    // CheckpointManager (可选依赖，用于自动保存检查点)
    {
      provide: CheckpointManager,
      useFactory: () => {
        return new CheckpointManager();
      },
    },
    // MissionOrchestrator 集成所有核心服务
    {
      provide: MissionOrchestrator,
      useFactory: (
        constraintEngine: ConstraintEngine,
        configService: ConfigService,
        toolRegistry: ToolRegistry,
        skillRegistry: SkillRegistry,
        llmFactory: LLMFactory,
        memoryService: ShortTermMemoryService,
        mcpManager: MCPManager,
        aiChatService: AiChatService,
        prismaService: PrismaService,
        traceCollector: TraceCollectorService,
        checkpointManager: CheckpointManager,
        a2aBus: A2AMessageBusService,
        missionExecutor?: MissionExecutorService,
        kernelJournal?: EventJournalService,
        runtimeStore?: MissionRuntimeStateStore,
        toolPipeline?: ToolPipeline,
      ) => {
        return new MissionOrchestrator(
          constraintEngine,
          configService,
          toolRegistry,
          skillRegistry,
          llmFactory,
          memoryService,
          mcpManager,
          aiChatService, // ★ 用于创建 LLM 适配器给 Skills 使用
          prismaService, // ★ 用于从数据库获取默认 AI 模型配置
          traceCollector, // ★ 用于执行链路可视化
          checkpointManager, // ★ 用于自动保存检查点
          a2aBus, // ★ 用于 Agent 间消息通信
          undefined, // config override (use defaults)
          missionExecutor, // ★ AI Kernel 进程追踪
          kernelJournal, // ★ AI Kernel 事件日志
          undefined, // adaptiveReplanner (Phase 4, 当前未注入)
          undefined, // hierarchicalMemory (Phase 6, 当前未注入)
          undefined, // lifecycleProtocol (Phase 8, 当前未注入)
          runtimeStore, // ★ Phase 9: 跨 pod 状态外置
          toolPipeline, // ★ 2026-05-01 (PR-X-R): skill 工具调用管线
        );
      },
      inject: [
        ConstraintEngine,
        ConfigService,
        ToolRegistry,
        SkillRegistry,
        LLMFactory,
        ShortTermMemoryService,
        MCPManager,
        AiChatService,
        PrismaService,
        TraceCollectorService,
        CheckpointManager,
        A2AMessageBusService,
        { token: MissionExecutorService, optional: true },
        { token: EventJournalService, optional: true },
        { token: MissionRuntimeStateStore, optional: true },
        { token: ToolPipeline, optional: true },
      ],
    },
    // TeamsService 依赖所有上层服务
    {
      provide: TeamsService,
      useFactory: (
        teamFactory: TeamFactory,
        teamRegistry: TeamRegistry,
        roleRegistry: RoleRegistry,
        missionOrchestrator: MissionOrchestrator,
        constraintEngine: ConstraintEngine,
      ) => {
        return new TeamsService(
          teamFactory,
          teamRegistry,
          roleRegistry,
          missionOrchestrator,
          constraintEngine,
        );
      },
      inject: [
        TeamFactory,
        TeamRegistry,
        RoleRegistry,
        MissionOrchestrator,
        ConstraintEngine,
      ],
    },
  ],
  exports: [
    RoleRegistry,
    TeamRegistry,
    MissionPipelineRegistry,
    ConstraintEngine,
    TeamFactory,
    MissionOrchestrator,
    TeamsService,
    CheckpointManager,
    A2AMessageBusService,
    MissionRuntimeStateStore,
    MissionLivenessGuard,
    // MissionAbortRegistry 由 @Global HarnessModule 提供（2026-05-08 PR-E0 fix）
    MissionOwnershipRegistry,
    RerunLockRegistry,
    AdaptiveReplannerService,
  ],
})
export class TeamsModule implements OnModuleInit {
  private readonly logger = new Logger(TeamsModule.name);

  constructor(
    private readonly roleRegistry: RoleRegistry,
    private readonly teamRegistry: TeamRegistry,
  ) {}

  /**
   * 模块初始化
   * 团队配置由各 AI App 模块在其 onModuleInit 中注册
   */
  onModuleInit() {
    this.logger.log(`TeamsModule initialized:`);
    this.logger.log(`  - Roles: ${this.roleRegistry.size()}`);
    this.logger.log(`  - Teams: ${this.teamRegistry.size()}`);
  }
}
