/**
 * AI Engine Module
 *
 * 聚合 L2 ai-engine 的 12 顶层能力聚合：
 * - llm · tools · rag · knowledge · content · skills
 * - planning · safety · routing · reliability · evaluation · facade
 *   （rag / content 为 provider 级，经 knowledge.module / ContentFetchModule +
 *    WebSearchModule 等装配，非独立 *.module.ts —— 见 standards/16 §二）
 *
 * 本层不承载 agent / mission / team 运行时语义。
 */

import {
  Module,
  Global,
  OnModuleInit,
  OnApplicationBootstrap,
  Logger,
  Inject,
} from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";
import { PrismaModule } from "../../common/prisma/prisma.module";
import { PrismaService } from "../../common/prisma/prisma.service";
import { SecretsModule } from "../platform/credentials/storage/secrets/secrets.module";

// ★ 子模块导入
import { AiEngineLLMModule } from "./llm/llm.module";
import { AiEngineToolsModule } from "./tools/tools.module";
import { AiEngineSkillsModule } from "./skills/skills.module";
import { AiEnginePlanningModule } from "@/modules/ai-engine/planning/planning.module";
// ★ 2026-06-02: 第 10 个 engine 聚合——通用语义打分路由 core（LLM/Tools/Skills 共用）
import { AiEngineRoutingModule } from "./routing/routing.module";
// AiEngineMemoryModule 已移除（2026-04-30）—— Memory 服务全部迁到
// ai-harness/memory（CLAUDE.md L2.5 规定 memory 是 Harness 一等公民），
// 由 RuntimeMemoryModule (@Global) 提供，无需 engine 层 forwardRef。
import { AiEngineSafetyModule } from "./safety/safety.module";
import { AiEngineKnowledgeModule } from "./knowledge/knowledge.module";
// ★ P2 能力下沉：新增子模块导入
import { EvidenceModule } from "./knowledge/evidence/evidence.module";
import { AiEngineEvaluationModule } from "./evaluation/evaluation.module";
import { AiEngineReliabilityModule } from "./reliability/reliability.module";
// ★ v1.5.3 P0a-3: LLM Wiki 共享一致性原语（StaleDetectorService）
import { ConsistencyModule } from "./knowledge/consistency/consistency.module";
// ★ HarnessModule / HarnessApiModule / RealtimeModule + CollaborationModule 由
// app.module.ts / harness.module.ts 直接装配（@Global，跨模块可注入）。
// AI Engine 不再反向依赖 ai-harness。

// Registries (从子模块重新导出，用于初始化)
import { ToolRegistry } from "./tools/registry/tool.registry";
import { SkillRegistry } from "./skills/registry/skill.registry";
// AgentRegistry 在 ai-harness/agents/registry，由 HarnessModule 装配；
// ai-engine.module 不再注入它，注册日志移至 HarnessModule onModuleInit。

// LLM Factory & Adapter (用于初始化)
import { LLMFactory } from "./llm/factory/llm.factory";
import { UniversalLLMAdapter } from "./llm/adapters/universal-llm.adapter";

// AiController + AiService moved to open-api/ai (PR-X6)
// They are now registered in AiModule, not here.

// ★ Phase 3: ContentAnalysisModule moved to ai-app/office/content-analysis/

// Content Fetch (generic URL fetch capability)
import { ContentFetchModule } from "./content/fetch/content-fetch.module";
import { WebSearchModule } from "./content/web-search/web-search.module";

// ★ Phase 3: SynthesisModule moved to ai-app/office/content-synthesis/

// Other Modules
// ImageModule（content/image，零注入死代码）已删除
// ★ 沉淀（2026-04-29）: figure 抽取（来自 {app}，TI 暂不切换）
//   不创建 sub-module，直接作为 provider 注册（ai-engine.module 已 @Global + imports AiEngineToolsModule）
import {
  FigureExtractorService,
  FigureRelevanceService,
} from "./content/figure";
// ★ PR-A8 (2026-05-07): markdown sanitizer 监控聚合器（in-memory，admin metrics 拉 snapshot）
import { SanitizerMetricsService } from "./content/markdown/sanitizer-metrics.service";
// ★ 沉淀（2026-04-29）: LLM Reranker（来自 {app}）
//   位置严格遵守"rerank 是 RAG 第二阶段（knowledge 子领域）"+"单向依赖"两条原则：
//   放 ai-engine/knowledge/rerank/ + 用 AiChatService（ai-engine 内层 LLM 调用）
import { LlmRerankerAdapter } from "./knowledge/rerank";
// ★ P17a (2026-05-24): 通用 ContentSourceRegistry（上提自 ai-app/social/registry）
import { ContentSourceRegistry } from "./content/sources/content-source-registry.service";
// ★ TeamsModule 已迁移到 ai-harness/teams（PR-X4），由 HarnessApiModule 统一装配
// ★ Phase 3: LongContentModule moved to ai-app/writing/content-engine/
import { PromptsModule } from "./llm/prompts/prompts.module";
import { CreditsModule } from "../platform/credits/credits.module";

// MCP moved to ai-engine/tools/adapters/mcp (PR-X7)
// MCPManager and MCPClientRegistryService are now provided by HarnessModule (@Global)

// Capabilities

// Observability core 全部由 ai-harness/ObservabilityModule (@Global) 提供，
// 包括 EvalPipelineService — engine 不再注册它们。

// Prompt Registry
import { PromptRegistryService } from "./llm/prompts/prompt-registry.service";

// ★ PR-X13: AIFacade + Domain Facades + FACADE_FEATURE_PROVIDERS + ModelResolverService
// 已迁移至 ai-harness/facade，由 HarnessModule (@Global) 统一装配。

// SKILL.md Runtime (PromptSkillRegistrationService + InputBindingResolver)
import { InputBindingResolver } from "./skills/integration/binding/skill-input-binding-resolver.service";
import { PromptSkillRegistrationService } from "./skills/integration/registration/prompt-skill-registration.service";

// ★ VotingManager 和 HandoffCoordinator 已迁移到 CollaborationModule
// (不再需要在此导入，通过 CollaborationModule 导出)

// Tools Token
import { ALL_TOOLS_TOKEN, TOTAL_TOOL_COUNT } from "./tools/tools.provider";
import { ITool } from "./tools/abstractions/tool.interface";

/**
 * AI Engine 核心模块
 */
@Global()
@Module({
  imports: [
    DiscoveryModule, // ★ P17a: ContentSourceRegistry 用 DiscoveryService 扫 @ContentSourceProvider()
    PrismaModule,
    SecretsModule,

    // ★ 子模块
    AiEngineLLMModule,
    AiEngineToolsModule,
    AiEngineSkillsModule,
    AiEnginePlanningModule,
    AiEngineSafetyModule,
    AiEngineKnowledgeModule,
    // ★ 2026-06-02: 通用语义打分路由 core
    AiEngineRoutingModule,
    // ★ P2 能力下沉：新增子模块
    EvidenceModule,
    AiEngineEvaluationModule,
    AiEngineReliabilityModule,
    // ★ v1.5.3 P0a-3: LLM Wiki / research / writing 共享一致性原语
    ConsistencyModule,
    // CollaborationModule 已搬到 ai-harness/teams/collaboration（@Global），
    // 由 harness.module 装配，无需在 engine 重复

    // Content Fetch (generic URL fetch capability)
    ContentFetchModule,
    WebSearchModule,

    // Other Modules
    // TeamsModule 已迁移到 ai-harness/teams（PR-X4），由 HarnessApiModule 统一装配
    PromptsModule,
    CreditsModule, // ★ 积分服务（用于 Facade 自动计费）
  ],
  controllers: [], // AiController moved to open-api/ai (PR-X6)
  providers: [
    // AiService moved to open-api/ai (PR-X6)

    // ★ VotingManager 和 HandoffCoordinator 已迁移到 CollaborationModule

    // === MCP moved to ai-engine/tools/adapters/mcp (PR-X7) ===
    // MCPManager and MCPClientRegistryService now provided by HarnessModule (@Global)

    // === Capabilities ===

    // === Observability (全部由 ai-harness/ObservabilityModule @Global 提供) ===

    // === Prompt Registry ===
    PromptRegistryService,

    // === Facade (PR-X13) ===
    // AIFacade / Domain Facades / FACADE_FEATURE_PROVIDERS / ModelResolverService
    // 已迁移至 ai-harness/facade，由 HarnessModule (@Global) 统一装配。

    // === SKILL.md Runtime ===
    PromptSkillRegistrationService,
    InputBindingResolver,

    // ★ 沉淀（2026-04-29）: figure-extractor（来自 {app}，{app} 复用）
    FigureExtractorService,
    FigureRelevanceService,
    // ★ 沉淀: LLM Reranker
    LlmRerankerAdapter,
    // ★ PR-A8 (2026-05-07): sanitizer metrics 聚合器
    SanitizerMetricsService,
    // ★ P17a (2026-05-24): 通用 ContentSourceRegistry — 任何 ai-app 可注册内容源
    ContentSourceRegistry,
  ],
  exports: [
    // ★ 重新导出子模块
    AiEngineLLMModule,
    AiEngineToolsModule,
    AiEngineSkillsModule,
    AiEnginePlanningModule,
    AiEngineSafetyModule,
    AiEngineKnowledgeModule,
    // ★ 2026-06-02: 通用语义打分路由 core
    AiEngineRoutingModule,
    // ★ P2 能力下沉：新增子模块导出
    EvidenceModule,
    AiEngineEvaluationModule,
    AiEngineReliabilityModule,
    // ★ v1.5.3 P0a-3: LLM Wiki / research / writing 共享一致性原语
    ConsistencyModule,
    // CollaborationModule 已搬到 ai-harness/teams/collaboration（@Global），
    // 由 harness.module 装配，无需在 engine 重复

    // Content Fetch (generic URL fetch capability)
    ContentFetchModule,
    WebSearchModule,

    // Other Modules
    // TeamsModule 已迁移到 ai-harness/teams（PR-X4），不再由 ai-engine 导出
    PromptsModule,

    // ★ VotingManager 和 HandoffCoordinator 通过 CollaborationModule 导出

    // === MCP moved to ai-engine/tools/adapters/mcp (PR-X7) — MCPManager exported by HarnessModule ===

    // === Capabilities ===

    // === Observability (全部由 ai-harness/ObservabilityModule @Global 提供) ===

    // === Prompt Registry ===
    PromptRegistryService,

    // === Facade (PR-X13) ===
    // AIFacade / Domain Facades / ModelResolverService
    // 已迁移至 ai-harness/facade，由 HarnessModule (@Global) 统一装配。

    // === SKILL.md Runtime ===
    PromptSkillRegistrationService,
    InputBindingResolver,

    // ★ 沉淀: figure-extractor 作为顶层 export
    FigureExtractorService,
    FigureRelevanceService,
    LlmRerankerAdapter,
    // ★ PR-A8 (2026-05-07): sanitizer metrics 顶层 export，admin / observability 拉 snapshot
    SanitizerMetricsService,
    // ★ P17a (2026-05-24): ContentSourceRegistry — ai-app/social 等 consumer 注入用
    ContentSourceRegistry,
  ],
})
export class AiEngineModule implements OnModuleInit, OnApplicationBootstrap {
  private readonly logger = new Logger(AiEngineModule.name);

  constructor(
    private readonly toolRegistry: ToolRegistry,
    private readonly skillRegistry: SkillRegistry,
    private readonly llmFactory: LLMFactory,
    private readonly universalLLMAdapter: UniversalLLMAdapter,
    private readonly prisma: PrismaService,
    // ★ 批量注入所有工具
    @Inject(ALL_TOOLS_TOKEN) private readonly allTools: ITool[],
  ) {}

  onModuleInit(): void {
    // 注册 LLM 适配器到工厂
    this.llmFactory.registerAdapter(this.universalLLMAdapter);

    // ★ 批量注册所有工具到 ToolRegistry
    for (const tool of this.allTools) {
      this.toolRegistry.register(tool);
    }

    this.logger.log("AI Engine Module initialized");
    this.logger.log(
      `  Tools: ${this.toolRegistry.size()} (expected: ${TOTAL_TOOL_COUNT})`,
    );
    this.logger.log(`  Skills: ${this.skillRegistry.size()}`);
    // Agents registry 由 HarnessModule 自报状态
    this.logger.log(
      `  LLM Adapters: ${this.llmFactory.getAllAdapters().length}`,
    );
  }

  /**
   * ★ T4 审计放在 onApplicationBootstrap（而非 onModuleInit）：本钩子在所有模块的
   * onModuleInit 完成之后才触发。memory 工具（ai-harness MemoryToolProviderService）
   * 与 organize 书签工具（ai-app/organize-chat）都在各自 onModuleInit 注册进同一个
   * @Global ToolRegistry，但晚于 AiEngineModule.onModuleInit。放到 bootstrap 阶段
   * 才校验，避免把"尚未注册就点名"的工具误报为孤儿（跨注册表感知的本质=等全员注册完）。
   */
  async onApplicationBootstrap(): Promise<void> {
    // ★ T4: 验证 ToolConfig 与 ToolRegistry 同步
    await this.validateToolConfigSync();
  }

  /**
   * ★ T4: 启动时验证 ToolConfig 与 ToolRegistry 同步
   * 检测孤立配置（数据库有配置但工具未注册）
   */
  private async validateToolConfigSync(): Promise<void> {
    try {
      const dbConfigs = await this.prisma.toolConfig.findMany({
        select: { toolId: true, enabled: true },
      });

      const registeredToolIds = new Set(
        this.toolRegistry.getAll().map((t) => t.id),
      );

      // Provider ID → Registry Tool ID 别名映射
      // 前端用 provider ID（如 openalex）保存配置，代码用 registry ID（如 openalex-search）注册工具
      const providerAliases: Record<string, string> = {
        openalex: "openalex-search",
        "alpha-vantage": "finance-api",
      };

      // 检查孤立配置：数据库有配置但 ToolRegistry 中没有对应工具（考虑别名）
      const orphanedConfigs = dbConfigs.filter(
        (config) =>
          !registeredToolIds.has(config.toolId) &&
          !registeredToolIds.has(providerAliases[config.toolId] ?? ""),
      );

      if (orphanedConfigs.length > 0) {
        this.logger.warn(
          `[T4] Found ${orphanedConfigs.length} orphaned ToolConfig entries (in DB but not in registry):`,
        );
        for (const config of orphanedConfigs) {
          this.logger.warn(`  - ${config.toolId} (enabled: ${config.enabled})`);
        }
        this.logger.warn(
          `  → These configs will be ignored. Consider removing them from the database.`,
        );
      }

      // 统计：有多少注册的工具在数据库中有配置
      const configuredToolIds = new Set(dbConfigs.map((c) => c.toolId));
      const unconfiguredTools = Array.from(registeredToolIds).filter(
        (id) => !configuredToolIds.has(id),
      );

      if (unconfiguredTools.length > 0) {
        this.logger.log(
          `[T4] ${unconfiguredTools.length} tools have no database config (using defaults)`,
        );
      }

      this.logger.log(
        `[T4] ToolConfig sync check: ${dbConfigs.length} DB configs, ${registeredToolIds.size} registered tools`,
      );
    } catch (error) {
      this.logger.error(
        `[T4] Failed to validate ToolConfig sync: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
