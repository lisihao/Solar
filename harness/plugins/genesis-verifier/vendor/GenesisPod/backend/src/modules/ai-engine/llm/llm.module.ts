/**
 * AI Engine LLM Module
 * LLM 适配层子模块
 *
 * 提供:
 * - AI Chat Service
 * - Task Profile Mapper
 * - Model Fallback
 * - LLM Factory & Adapters
 */

import { Module, forwardRef } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { SecretsModule } from "../../platform/credentials/storage/secrets/secrets.module";
import { UserApiKeysModule } from "../../platform/credentials/user-owned/user-api-keys/user-api-keys.module";
import { KeyResolverModule } from "../../platform/credentials/resolution/key-resolver/key-resolver.module";
import { KeyExecutorModule } from "../../platform/credentials/resolution/executor/key-executor.module";
import { UserModelConfigsModule } from "../../platform/credentials/user-owned/user-model-configs/user-model-configs.module";
import { AiEngineSafetyModule } from "../safety/safety.module";
import { AiEnginePlanningModule } from "../planning/planning.module";
import * as http from "http";
import * as https from "https";

// LLM Core
import { LLMFactory } from "./factory/llm.factory";
import { FunctionCallingLLMAdapter } from "./adapters/function-calling-llm.adapter";
import { AiChatLLMAdapter } from "./adapters/ai-chat-llm.adapter";
import { UniversalLLMAdapter } from "./adapters/universal-llm.adapter";
import { TaskProfileMapperService } from "./chat/task-profile-mapper.service";

// Core Services
import { AiChatService } from "./chat/ai-chat.service";
import { AiModelConfigService } from "./models/config/ai-model-config.service";
import { AiApiCallerService } from "./providers/ai-api-caller.service";
// 2026-06：AiApiCallerService 拆分出的 per-provider HTTP callers（thin facade delegate 到这些）。
// BaseHttpCaller 是 abstract 基类（共享逻辑），不注册为 provider。
import { OpenaiCaller } from "./providers/openai-caller";
import { AnthropicCaller } from "./providers/anthropic-caller";
import { CohereCaller } from "./providers/cohere-caller";
import { GoogleCaller } from "./providers/google-caller";
import { XaiCaller } from "./providers/xai-caller";
// v3.1 阶段 D.1 (2026-05-24)：从 AiApiCallerService god-class 抽出的 self-heal 触发器
import { ApiCallerSelfHealTriggerService } from "./providers/api-caller-self-heal-trigger.service";
import { AiStreamHandlerService } from "./chat/ai-stream-handler.service";
import { AiChatPromptService } from "./chat/ai-chat-prompt.service";
import { AiChatRetryService } from "./chat/ai-chat-retry.service";
// 2026-05-05 抽自 AiChatService（god-class size 治理）：BYOK per-key failover 路径
import { AiChatFailoverCallerService } from "./chat/ai-chat-failover-caller.service";

// Extracted Services (from ai-chat.service.ts God Object split)
import { AiConnectionTestService } from "./byok/ai-connection-test.service";
import { AiModelDiscoveryService } from "./models/catalog/ai-model-discovery.service";
import { ModelTypeService } from "./models/catalog/model-type.service";
import { ApiFormatService } from "./models/catalog/api-format.service";
import { AiProviderService } from "./models/catalog/ai-provider.service";
import { AiDirectKeyService } from "./byok/ai-direct-key.service";
import { AiImageGenerationService } from "./image/ai-image-generation.service";
import { PromptCacheCoordinatorService } from "./chat/prompt-cache-coordinator.service";
import { SystemModelInventoryService } from "./models/catalog/system-model-inventory.service";

// Model Fallback
import { ModelFallbackService } from "./models/selection/model-fallback.service";

// Auto-configure service (used by UserModelConfigsAutoController in ai-app/byok)
import { AutoConfigureService } from "./byok/user-models-auto-configure.service";

// Long-term editable recommendation matrix (user + admin auto-configure share this)
import { ModelRecommendationsService } from "./models/selection/model-recommendations.service";

// Environment-aware model election (pick modelId from env snapshot + request hints)
// NOTE: stateless scoring only. Mission-scoped election state (MissionElectionTracker)
// was relocated to ai-harness/guardrails/runtime on 2026-06-02 (MECE audit P0-1) —
// engine must not hold mission state.
import { ModelElectionService } from "./models/selection/model-election.service";

// Single source of truth for model pricing (DB AIModel table → in-memory hydrate)
import { ModelPricingRegistry } from "./models/pricing/model-pricing.registry";

// Provider-aware structured output adapter router (covers商用 + 本地全部主流 provider)
import { StructuredOutputRouter } from "./output/structured/structured-output-router.service";

// v3.1 阶段 A：capability 只读链（SSOT，替代 router 内 PROVIDER_DEFAULT_CHAINS）
import { ModelCapabilityService } from "./models/capability/model-capability.service";
// v3.1 阶段 B 子片 2：capability_overrides 写入面 + self-heal（D2 + §4.5 同事务 + §4.4 阈值/lock/cooling-off）
import { CapabilityOverridesWriterService } from "./models/capability/capability-overrides-writer.service";
import { CapabilitySelfHealService } from "./models/capability/capability-self-heal.service";
// v3.1 阶段 B 子片 3 (2026-05-24)：feature flag 体系 + probe daemon（@Cron 6h + 分布式锁 + catalog version bump 复原）
import { CapabilityFeatureFlagsService } from "./models/capability/capability-feature-flags.service";
import { CapabilityProbeService } from "./models/capability/capability-probe.service";

@Module({
  imports: [
    HttpModule.register({
      timeout: 120000,
      maxRedirects: 3,
      httpAgent: new http.Agent({
        keepAlive: true,
        keepAliveMsecs: 30000,
        maxSockets: 50,
        maxFreeSockets: 10,
        maxHeaderSize: 64 * 1024,
      } as http.AgentOptions & { maxHeaderSize: number }),
      httpsAgent: new https.Agent({
        keepAlive: true,
        keepAliveMsecs: 30000,
        maxSockets: 50,
        maxFreeSockets: 10,
        maxHeaderSize: 64 * 1024,
      } as https.AgentOptions & { maxHeaderSize: number }),
      // Axios config for large responses（LLM 1M context + 长输出可达 30MB）
      maxContentLength: 50 * 1024 * 1024, // 50MB
      maxBodyLength: 50 * 1024 * 1024, // 50MB
    }),
    SecretsModule,
    UserApiKeysModule,
    KeyResolverModule, // BYOK v2: 统一 API Key 解析
    KeyExecutorModule, // BYOK v3 (PR-4): 失效切换 + LastGood 粘性
    UserModelConfigsModule, // BYOK v3: 用户自定义多模型
    AiEngineSafetyModule,
    forwardRef(() => AiEnginePlanningModule),
  ],
  providers: [
    // LLM Factory & Adapters
    LLMFactory,
    FunctionCallingLLMAdapter,
    AiChatLLMAdapter,
    UniversalLLMAdapter,

    // Services
    TaskProfileMapperService,
    AiModelConfigService,
    AiApiCallerService,
    // 2026-06：per-provider HTTP callers（AiApiCallerService thin facade 的 delegate 目标）
    OpenaiCaller,
    AnthropicCaller,
    CohereCaller,
    GoogleCaller,
    XaiCaller,
    // v3.1 阶段 D.1：self-heal 触发器（god-class 拆分）
    ApiCallerSelfHealTriggerService,
    AiStreamHandlerService,
    AiChatPromptService,
    AiChatRetryService,
    AiChatFailoverCallerService,
    AiChatService,

    // Extracted Services
    AiConnectionTestService,
    AiModelDiscoveryService,
    ModelTypeService,
    ApiFormatService,
    AiProviderService,
    AiDirectKeyService,
    AiImageGenerationService,

    // BYOK v3 auto-configure
    AutoConfigureService,
    ModelRecommendationsService,

    // Prompt Cache
    PromptCacheCoordinatorService,

    // Model Fallback
    ModelFallbackService,

    // Admin — 系统模型全景
    SystemModelInventoryService,

    // Environment-aware model election (stateless scoring; mission-scoped
    // diversity tracker relocated to ai-harness 2026-06-02 P0-1)
    ModelElectionService,

    // Pricing single source of truth (replaces 3 hardcoded tables)
    ModelPricingRegistry,

    // v3.1 阶段 A：capability 只读链（SSOT，catalog 数据驱动）
    ModelCapabilityService,

    // v3.1 阶段 B 子片 2：capability_overrides 写入面 SSOT（admin / BYOK / self-heal 全部经此）
    CapabilityOverridesWriterService,
    // v3.1 阶段 B 子片 2：self-heal 决策栈（feature flag + 信号校验 + cooling-off + 阈值 + advisory lock）
    CapabilitySelfHealService,
    // v3.1 阶段 B 子片 3：feature flag 体系（env + Redis 热切换）
    CapabilityFeatureFlagsService,
    // v3.1 阶段 B 子片 3：probe daemon（@Cron 6h + 分布式锁 + catalog version bump 反向复原）
    CapabilityProbeService,

    // Structured output router（管理员可配置首选 strategy + fallback；未配置由
    // ModelCapabilityService.deriveStructuredOutputChain 派生；最终兜底 prompt）
    StructuredOutputRouter,
  ],
  exports: [
    LLMFactory,
    FunctionCallingLLMAdapter,
    AiChatLLMAdapter,
    UniversalLLMAdapter,
    TaskProfileMapperService,
    AiModelConfigService,
    AiApiCallerService,
    AiStreamHandlerService,
    AiChatPromptService,
    AiChatRetryService,
    AiChatFailoverCallerService,
    AiChatService,
    AiConnectionTestService,
    AiModelDiscoveryService,
    ModelTypeService,
    ApiFormatService,
    AiProviderService,
    AiDirectKeyService,
    AiImageGenerationService,
    PromptCacheCoordinatorService,
    ModelFallbackService,
    ModelRecommendationsService,
    SystemModelInventoryService,
    ModelElectionService,
    AutoConfigureService,
    ModelPricingRegistry,
    // v3.1 阶段 A review (2026-05-24)：ModelCapabilityService 故意**不** export。
    // 它只在 llm.module 内部供 StructuredOutputRouter + AiApiCallerService 注入，
    // 不对外暴露（防 ai-app 直读 caps 后散点 if 判断；v3 §3.6 SSOT 守护）。
    // v3.1 阶段 B 子片 2：writer / self-heal 必须 export 给 admin/BYOK controllers
    // 调用（admin 在 open-api/admin，BYOK 在 ai-app/byok，都通过 AiEngineLLMModule
    // 拿到 service 实例；ModelCapabilityService 不 export 是因为它被 ai-app 直读会
    // 破坏 SSOT，这两个 service 是写入入口而非读取面，必须暴露）。
    CapabilityOverridesWriterService,
    CapabilitySelfHealService,
    // v3.1 阶段 B 子片 3：flag service export 供 admin 路径写 Redis 热切换；
    // probe service 不 export（@Cron 自驱动，无消费方）
    CapabilityFeatureFlagsService,
    StructuredOutputRouter,
  ],
})
export class AiEngineLLMModule {}
