import {
  Injectable,
  Logger,
  Optional,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AiServiceUnavailableError } from "@/modules/ai-engine/llm/abstractions/ai-service.exception";
import { AIModelType } from "@prisma/client";
import { RequestContext } from "@/common/context/request-context";
import { withUserContext } from "@/common/context/with-user-context";
import { TaskProfile, ChatMessage } from "../types";
import { inferIsReasoning } from "../types/model.utils";
import { TaskProfileMapperService } from "./task-profile-mapper.service";
import {
  AiModelConfigService,
  AIModelConfig,
} from "../models/config/ai-model-config.service";
// 模型级 failover：chat() 的 BYOK 换模型逻辑抽到独立 util（god-class 不膨胀）。
import { runChatWithModelFailover } from "../models/selection/chat-model-failover.util";
// ★ 2026-05-21 Capability Contract: modelType 选择的单一权威（quality-first 默认）
import {
  resolveEffectiveModelType,
  normalizeDowngradePolicy,
} from "../models/selection/model-policy";
import { AiApiCallerService } from "../providers/ai-api-caller.service";
import { AiStreamHandlerService } from "./ai-stream-handler.service";
import { AIMetricsService } from "@/modules/platform/facade";
import { GuardrailsPipelineService } from "../../safety/guardrails/guardrails-pipeline.service";
// ★ P1 PII 脱敏：消费侧改写逻辑抽到 helper，避免 god-class 增长（真生效，非 inert）。
import {
  redactUserMessages,
  resolveRedactedOutput,
} from "./pii-guardrail-redaction.helper";
// ★ L2 ai-engine 内部代码禁止从 @/modules/ai-engine/facade 导入 —— facade 是 L3
// AI App 的单向入口，L2 自己走 facade barrel 会触发 barrel → 50+ 子模块 → L2
// 的回环加载，在 module-evaluation 阶段产生 undefined class ref，Nest DI 随后
// 报 "LlmExecutor dependency at index [0]"。全部改直接相对路径。
import {
  EntityHealthRegistry,
  TaskCompletionType,
} from "../../reliability/entity-health/entity-health.registry";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { randomUUID } from "crypto";
// ★ 拆分后的子服务
import { AiConnectionTestService } from "../byok/ai-connection-test.service";
import { AiModelDiscoveryService } from "../models/catalog/ai-model-discovery.service";
import { AiDirectKeyService } from "../byok/ai-direct-key.service";
import { AiImageGenerationService } from "../image/ai-image-generation.service";
import { AiChatRetryService } from "./ai-chat-retry.service";
import { MissionContext } from "@/common/context/mission-context";
import { BillingContext } from "@/modules/platform/facade";
import { ModelPricingRegistry } from "../models/pricing/model-pricing.registry";
import { KeyResolverService } from "@/modules/platform/credentials/resolution/key-resolver/key-resolver.service";
import { AiChatFailoverCallerService } from "./ai-chat-failover-caller.service";
// v5.1 R0.5 PR-5: 双轨接 plugins/core HookBus
import type { HookBus } from "@/plugins/core/hook-bus";
import {
  CORE_HOOKS,
  HookAbortError,
  type LlmRequestPayload,
  type LlmResponsePayload,
} from "@/plugins/core/abstractions";
import {
  BYOKError,
  InvalidApiKeyError,
  NoAvailableKeyError,
  QuotaExceededError,
} from "@/modules/platform/credentials/resolution/key-resolver/key-resolver.errors";

export interface ChatCompletionOptions {
  model: string;
  systemPrompt?: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  /** 任务配置：语义化方式描述任务需求，AI Engine 自动映射参数 */
  taskProfile?: TaskProfile;
  /** 严格模式：API失败时抛出异常而不是返回错误内容 */
  strictMode?: boolean;
  /** 用户 ID（用于 BYOK Key 优先级解析） */
  userId?: string;
  /** Trace ID（用于可观测性链路追踪） */
  traceId?: string;
  /** 响应格式：json 时启用 JSON mode */
  responseFormat?: string;
  /** AI Kernel 进程 ID（用于 Journal/Cost/Metrics 追踪） */
  processId?: string;
  /** Reasoning depth for reasoning models (mapped from TaskProfile) */
  reasoningDepth?: import("../types").ReasoningDepth;
  /** Prompt cache policy */
  cachePolicy?: "auto";
  /** Native structured output schema */
  outputSchema?: { type: "json_schema"; schema: Record<string, unknown> };
  /** 2026-05-06 router: 让 AiApiCallerService 按 strategy 走 native API 路径
   * （response_format / tools / generationConfig）而非仅 system-prompt hint */
  structuredOutputStrategy?: import("../output/structured/structured-output-strategy.types").StructuredOutputStrategy;
  outputJsonSchema?: Record<string, unknown>;
  schemaName?: string;
  /**
   * LLM Function Calling: tool schemas to expose to the model.
   * Passed through transparently; actual provider support depends on the
   * underlying adapter. Providers that do not support tools ignore this field.
   */
  tools?: import("../../tools/abstractions/tool.interface").FunctionDefinition[];
}

export interface ChatCompletionResult {
  content: string;
  model: string;
  tokensUsed: number;
  /** 输入 token 数 */
  inputTokens?: number;
  /** 输出 token 数 */
  outputTokens?: number;
  /** Prompt Cache 写入 token 数（Anthropic） */
  cacheCreationTokens?: number;
  /** Prompt Cache 命中 token 数（Anthropic / OpenAI） */
  cacheReadTokens?: number;
  /** API 返回的完成原因（"stop"=正常完成, "length"=截断） */
  finishReason?: string;
  /** 推理模型思考链文本（reasoning_content）；content 只放可见输出。 */
  reasoning?: string;
  /** 标识此响应是否为错误消息（仅在非严格模式下有值） */
  isError?: boolean;
  /** 错误分类类型（仅在 isError=true 时有值，用于 fallback 决策） */
  errorType?: string;
  /** BYOK: API Key 来源（personal=用户自用, assigned=管理员分配, system=系统） */
  apiKeySource?: "personal" | "assigned" | "system";
  /**
   * LLM Function Calling: tool call requests returned by the model.
   * Populated when the model responds with tool_use / function_call instead of plain text.
   */
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
}

// Re-export types for backward compatibility
export type { AIModelConfig } from "../models/config/ai-model-config.service";
export type { ChatMessage } from "../types";

/**
 * AI Chat Service - Thin Coordinator
 *
 * 核心职责：
 * 1. chat() — 统一入口，参数解析 + 路由到 Path A (系统配置) 或 Path B (BYOK 直连)
 * 2. chatStream() — 流式输出
 * 3. generateChatCompletion() — Path A 核心调用
 * 4. callAPIWithConfig() — 路由到 AiApiCallerService
 *
 * 已提取到独立服务：
 * - AiConnectionTestService: 连接测试
 * - AiModelDiscoveryService: 模型发现/列表
 * - AiDirectKeyService: BYOK 直连 (Path B)
 * - AiImageGenerationService: 图片生成 (DALL-E/Imagen)
 * - AiChatPromptService: Web 搜索、URL 增强（已存在）
 * - AiChatRetryService: 重试策略（已存在）
 * - AiModelConfigService: 模型配置查询（已存在）
 */
/**
 * AiChatService.chat 的入参类型（供外部 wrapper / observer 直接引用，避免 Parameters<> 自引用）
 */
export interface ChatOptions {
  messages: ChatMessage[];
  systemPrompt?: string;
  taskProfile?: TaskProfile;
  maxTokens?: number;
  temperature?: number;
  model?: string;
  modelType?: AIModelType;
  strictMode?: boolean;
  provider?: string;
  apiKey?: string;
  apiEndpoint?: string;
  displayName?: string;
  capabilities?: string[];
  enableSearch?: boolean;
  userId?: string;
  traceId?: string;
  responseFormat?: string;
  processId?: string;
  /** Skip input/output guardrails for internal system calls */
  skipGuardrails?: boolean;
  /**
   * 服务端内部管线调用（agent-to-agent，无直接用户输入）的弱化护栏档：
   * 与 skipGuardrails（整体跳过）不同，regex 护栏照常运行（含 block 短路与
   * PII 脱敏），但可疑（warning）结果只记日志、不升级 LLM moderation 不 block。
   * 外部网页/研究语料高误报场景用此档，见 GuardrailInput.trustedInternal。
   */
  trustedInternal?: boolean;
  /** Prompt cache policy */
  cachePolicy?: "auto";
  /** Native structured output schema */
  outputSchema?: { type: "json_schema"; schema: Record<string, unknown> };
  /** 2026-05-06 router native API path 透传（见 ChatCompletionOptions 注释）*/
  structuredOutputStrategy?: import("../output/structured/structured-output-strategy.types").StructuredOutputStrategy;
  outputJsonSchema?: Record<string, unknown>;
  schemaName?: string;
  /** Shared cache prefix from PromptCacheCoordinatorService — uses frozen system prompt + tools */
  sharedCachePrefix?: {
    systemPromptText: string;
    toolDefinitions?: unknown[];
  };
  /** 操作名称 — 用于时延跟踪标识 step */
  operationName?: string;
  /**
   * AbortSignal — 用户取消 / 超时 / budget 耗尽时提前中止当次调用。
   *
   * 实施说明（Gate 1 决策）：
   * - 接受 signal 是 backward-compat overload；既有调用方不传 signal 行为不变
   * - AiChatService 在调用下游 API / stream 前检查 signal.aborted；
   *   已在途的 HTTP 请求不保证立刻 abort（需要 fetch 层 propagate）
   * - 最小语义：signal.aborted 时抛 DOMException("...", "AbortError")
   */
  signal?: AbortSignal;
  /**
   * LLM Function Calling: tool schemas to expose to the model.
   * Passed through to the underlying adapter transparently via [key: string] index.
   * Providers that do not support tools silently ignore this field.
   */
  tools?: import("../../tools/abstractions/tool.interface").FunctionDefinition[];
}

/**
 * AiChatService.chat 的返回类型
 */
export interface ChatResult {
  content: string;
  usage?: {
    totalTokens: number;
    inputTokens?: number;
    outputTokens?: number;
    cacheCreationTokens?: number;
    cacheReadTokens?: number;
  };
  model: string;
  finishReason?: string;
  /** 推理模型思考链文本（reasoning_content）；供 harness 在 thinking 为空时回退展示。 */
  reasoning?: string;
  isError?: boolean;
  apiKeySource?: "personal" | "assigned" | "system";
  /**
   * LLM Function Calling: tool call requests returned by the model.
   * Present only when the LLM decides to call one or more tools.
   */
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
}

/**
 * Chat 调用观察者事件（observer pattern）
 *
 * 订阅 AiChatService.chat 的入参 / 返回值 / 异常 / 延迟，用于：
 * - Topic Insights baseline 录制（fixture 对比）
 * - 调试 / 审计场景
 *
 * 订阅通过 `addChatObserver(fn)`，解除用 `removeChatObserver(fn)`。
 * Observer 函数抛错会被 catch 并降级为 warn log，不影响 chat 主流程。
 */
export interface ChatObserverEvent {
  options: ChatOptions;
  result?: ChatResult;
  error?: Error;
  durationMs: number;
  /** 便于观察者从 MissionContext 取 missionId / baselineTag 之外直接拿到 */
  missionContext?: import("../../../../common/context/mission-context").MissionContextData;
}

export type ChatObserver = (event: ChatObserverEvent) => void;

@Injectable()
export class AiChatService {
  private readonly logger = new Logger(AiChatService.name);

  /** Chat 观察者列表 — 非生产热路径，Set 保持去重 + 插入顺序 */
  private readonly chatObservers = new Set<ChatObserver>();

  constructor(
    private readonly configService: ConfigService,
    private readonly taskProfileMapper: TaskProfileMapperService,
    private readonly modelConfigService: AiModelConfigService,
    private readonly apiCallerService: AiApiCallerService,
    private readonly streamHandlerService: AiStreamHandlerService,
    private readonly retryService: AiChatRetryService,
    @Optional() private readonly aiMetricsService?: AIMetricsService,
    @Optional()
    private readonly guardrailsPipeline?: GuardrailsPipelineService,
    @Optional() private readonly circuitBreaker?: EntityHealthRegistry,
    @Optional()
    private readonly connectionTestService?: AiConnectionTestService,
    @Optional()
    private readonly modelDiscoveryService?: AiModelDiscoveryService,
    @Optional() private readonly directKeyService?: AiDirectKeyService,
    @Optional()
    private readonly imageGenerationService?: AiImageGenerationService,
    private readonly events?: EventEmitter2,
    @Optional() private readonly keyResolver?: KeyResolverService,
    @Optional()
    private readonly failoverCaller?: AiChatFailoverCallerService,
    @Optional() private readonly pricingRegistry?: ModelPricingRegistry,
  ) {}

  /**
   * 估算 LLM 调用成本（USD）
   * 走 ModelPricingRegistry 单一价格源（DB AIModel 表）；未注册返 null。
   * 调用方需要数值时自行 ?? 0 兜底。
   */
  private costFor(
    model: string,
    inputTokens: number,
    outputTokens: number,
    cacheReadTokens = 0,
    cacheWriteTokens = 0,
  ): number | null {
    return (
      this.pricingRegistry?.estimateCost(
        model,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
      ) ?? null
    );
  }

  // ==================== 模型配置委托方法 ====================

  /**
   * 获取模型的 API Key
   * 委托给 AiModelConfigService
   */
  async getApiKeyForModel(model: AIModelConfig): Promise<string | null> {
    return this.modelConfigService.getApiKeyForModel(model);
  }

  /**
   * 检查模型是否为推理模型（委托给 AiModelConfigService）
   */
  isReasoningModel(modelId: string): boolean {
    return this.modelConfigService.isReasoningModel(modelId);
  }

  /**
   * 记录 LLM 调用指标（非阻塞）
   */
  private recordLLMMetrics(params: {
    modelId: string;
    providerId?: string;
    userId?: string;
    duration: number;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    success: boolean;
    errorCode?: string;
    errorMsg?: string;
    operationId?: string;
  }): void {
    if (!this.aiMetricsService) {
      return;
    }

    this.aiMetricsService
      .recordMetric({
        metricType: "llm_call",
        operationId: params.operationId,
        modelId: params.modelId,
        providerId: params.providerId,
        userId: params.userId,
        duration: params.duration,
        inputTokens: params.inputTokens,
        outputTokens: params.outputTokens,
        success: params.success,
        errorCode: params.errorCode,
        errorMsg: params.errorMsg,
      })
      .catch((err) => {
        this.logger.warn(`[AIMetrics] Failed to record metric: ${err.message}`);
      });
  }

  /**
   * 自动将 LLM 调用记录到 MissionContext 中活跃的 LatencySession（如有）
   * 通过 EventEmitter2 发出事件，由 LlmEventsListener 转发到 SessionLatencyTrackerService
   */
  private recordToLatencySession(
    model: string,
    provider: string,
    durationMs: number,
    totalTokens: number,
    streaming: boolean,
    ttftMs?: number,
    inputTokens?: number,
    outputTokens?: number,
    operationName?: string,
  ): void {
    const ctx = MissionContext.get();
    if (!ctx?.latencySessionId) return;

    this.emitLatencyAction(ctx.latencySessionId, {
      stepId: ctx.latencyPhaseId,
      name: operationName || "llm_call",
      type: "llm_call",
      model,
      provider,
      streaming,
      ttftMs,
      ttltMs: durationMs,
      totalDurationMs: durationMs,
      inputTokens: inputTokens ?? 0,
      outputTokens: outputTokens ?? (totalTokens || 0),
    });
  }

  // ==================== EventEmitter2 辅助方法 ====================

  private emitSpanStart(
    traceId: string,
    input: {
      spanType?: string;
      name: string;
      type?: string;
      metadata?: Record<string, unknown>;
    },
  ): string {
    const correlationId = randomUUID();
    this.events?.emit("llm.span.start", { correlationId, traceId, ...input });
    return correlationId;
  }

  private emitSpanEnd(
    correlationId: string,
    input: {
      status: string;
      error?: string;
      output?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    },
  ): void {
    this.events?.emit("llm.span.end", { correlationId, ...input });
  }

  private emitJournalRecord(
    processId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): void {
    this.events?.emit("llm.journal.record", { processId, eventType, payload });
  }

  private emitCostRecord(input: Record<string, unknown>): void {
    this.events?.emit("llm.cost.record", input);
  }

  private emitMetrics(input: Record<string, unknown>): void {
    this.events?.emit("llm.metrics.record", input);
  }

  private emitLatencyAction(
    sessionId: string,
    action: Record<string, unknown>,
  ): void {
    this.events?.emit("llm.latency.action", { sessionId, ...action });
  }

  /**
   * 获取模型配置（委托给 AiModelConfigService）
   */
  async getModelConfig(modelId: string): Promise<AIModelConfig | null> {
    return this.modelConfigService.getModelConfig(modelId);
  }

  /**
   * 获取默认模型配置（委托给 AiModelConfigService）
   */
  async getDefaultModelConfig(): Promise<AIModelConfig | null> {
    return this.modelConfigService.getDefaultModelConfig();
  }

  /**
   * ★ 按模型类型获取默认模型配置
   * @deprecated 使用 AiModelConfigService.getDefaultModelByType() 替代
   */
  async getDefaultModelByType(
    modelType: AIModelType,
  ): Promise<AIModelConfig | null> {
    return this.modelConfigService.getDefaultModelByType(modelType);
  }

  /**
   * ★ 获取指定类型的所有启用模型（用于 fallback）
   * @deprecated 使用 AiModelConfigService.getAllEnabledModelsByType() 替代
   */
  async getAllEnabledModelsByType(
    modelType: AIModelType,
    excludeModelIds: string[] = [],
  ): Promise<AIModelConfig[]> {
    return this.modelConfigService.getAllEnabledModelsByType(
      modelType,
      excludeModelIds,
    );
  }

  /**
   * 根据 provider 确定 API 格式类型（启发式 fallback；最后兜底）。
   *
   * **v3.1 §D.2.3 (2026-05-24) 显式 fallback 警告**：
   *   - 调用方手里有 `AIModelConfig`（DB 来源）时，**必须**优先读 DB 字段：
   *     `const apiFormat = modelConfig.apiFormat ?? this.getApiFormatForProvider(modelConfig.provider);`
   *   - 不允许仅靠本启发式覆盖管理员在 DB 配的 apiFormat 真值（B+ apiFormat
   *     backfill 已把可知 provider 的 apiFormat 灌进 DB，新代码请直读）。
   *   - 仅在 `modelConfig.apiFormat` 为空 / undefined 时落到本启发式作 fallback。
   */
  private getApiFormatForProvider(
    provider: string,
  ): "openai" | "anthropic" | "google" | "xai" {
    const p = provider.toLowerCase();
    if (p === "anthropic" || p === "claude") return "anthropic";
    if (p === "google" || p === "gemini") return "google";
    if (p === "xai" || p === "grok") return "xai";
    return "openai";
  }

  /**
   * 获取指定模型所需的 API 密钥环境变量名（启发式 fallback）。
   *
   * **v3.1 §D.2.3 (2026-05-24) 显式 fallback 警告**：
   *   - AIModelConfig 暂未定义 `requiredApiKey` 字段，本启发式作为
   *     env var 名解析的最后兜底保留。
   *   - 长期目标：把 env var 名也 DB 化（admin 配 `requiredApiKey`），
   *     调用方按 `config.requiredApiKey ?? getRequiredApiKeyName(model)` 显式 fallback。
   *   - 在此之前，新代码遇到本函数请考虑是否真的需要 env var 名（多数 BYOK
   *     路径走 KeyResolver SSOT，不需要 env var 名）。
   *
   * @deprecated 优先使用 KeyResolver + 数据库配置（apiKey / secretKey）
   */
  getRequiredApiKeyName(model: string): string {
    const modelLower = model.toLowerCase();
    if (modelLower === "grok" || modelLower.includes("grok")) {
      return "XAI_API_KEY";
    } else if (
      modelLower === "gpt-4" ||
      modelLower.includes("gpt") ||
      modelLower.startsWith("o1") ||
      modelLower.startsWith("o3")
    ) {
      return "OPENAI_API_KEY";
    } else if (modelLower === "claude" || modelLower.includes("claude")) {
      return "ANTHROPIC_API_KEY";
    } else if (modelLower === "gemini" || modelLower.includes("gemini")) {
      return "GOOGLE_AI_API_KEY";
    }
    return "GOOGLE_AI_API_KEY";
  }

  /**
   * 验证 AI 服务是否可用
   */
  async validateAIServiceAvailability(model?: string): Promise<void> {
    let targetModel = model;
    let hasDbConfig = false;

    if (model) {
      const dbConfig = await this.getModelConfig(model);
      if (dbConfig && dbConfig.apiKey) {
        hasDbConfig = true;
        targetModel = dbConfig.modelId;
      }
    } else {
      const defaultConfig = await this.getDefaultModelConfig();
      if (defaultConfig && defaultConfig.apiKey) {
        hasDbConfig = true;
        targetModel = defaultConfig.modelId;
      }
    }

    if (!hasDbConfig) {
      // CLAUDE.md 红线：fallback 模型名必须为空字符串，由下游 UserModelResolver
      // 从 DB 解析。绝不硬编码 "gemini" / "gpt-4" 等字面量，否则 DB 没配对应
      // 模型时会把一个根本不存在的 modelId 透传下去并报"模型未配置"。
      targetModel =
        targetModel || this.configService.get<string>("DEFAULT_AI_MODEL", "");
      if (!targetModel) {
        throw new AiServiceUnavailableError(
          "AI 服务不可用：没有可用模型。请在数据库中至少配置 1 个启用的 AI 模型，或设置 DEFAULT_AI_MODEL 环境变量。",
          "",
        );
      }
      const requiredEnvKey = this.getRequiredApiKeyName(targetModel);

      if (!this.configService.get<string>(requiredEnvKey)) {
        throw new AiServiceUnavailableError(
          `AI服务不可用: 模型 "${targetModel}" 未在数据库中配置，且环境变量 ${requiredEnvKey} 也未设置`,
          targetModel,
        );
      }
    }

    try {
      const testResult = await this.generateChatCompletion({
        model: targetModel!,
        messages: [{ role: "user", content: "Hello" }],
        // maxTokens=10 之前在推理模型上经常 truncate 到空输出（o1/o3/gpt-5
        // 系列会先消耗 reasoning tokens 再出可见内容）。100 是覆盖绝大多数
        // provider 最小 output buffer 的安全值，同时成本可忽略。
        maxTokens: 100,
        temperature: 0,
      });

      if (
        testResult.content.includes("API Key 未配置") ||
        testResult.content.includes("API 调用失败") ||
        testResult.content.includes("无法生成回复")
      ) {
        throw new AiServiceUnavailableError(
          `AI服务响应异常: ${testResult.content.slice(0, 100)}`,
          targetModel,
        );
      }
    } catch (error) {
      if (error instanceof AiServiceUnavailableError) {
        throw error;
      }
      throw new AiServiceUnavailableError(
        `AI服务连接测试失败: ${error instanceof Error ? error.message : String(error)}`,
        targetModel,
      );
    }
  }

  /**
   * 检查指定模型的 API 密钥是否已配置（异步）
   */
  async isApiKeyConfiguredAsync(model: string): Promise<boolean> {
    const dbConfig = await this.getModelConfig(model);
    if (dbConfig && dbConfig.apiKey) {
      return true;
    }
    const requiredEnvKey = this.getRequiredApiKeyName(model);
    return !!this.configService.get<string>(requiredEnvKey);
  }

  /**
   * 检查指定模型的 API 密钥是否已配置（同步）
   * @deprecated 优先使用 isApiKeyConfiguredAsync
   */
  isApiKeyConfigured(model: string): boolean {
    const requiredEnvKey = this.getRequiredApiKeyName(model);
    return !!this.configService.get<string>(requiredEnvKey);
  }

  /**
   * 获取所有已配置的 AI 模型列表（从数据库）
   */
  async getAvailableModelsAsync(): Promise<string[]> {
    try {
      const chatModels =
        await this.modelConfigService.getAllEnabledModelsByType(
          AIModelType.CHAT,
        );
      const models: string[] = [];
      for (const config of chatModels) {
        const apiKey = await this.modelConfigService.getApiKeyForModel(config);
        if (apiKey) {
          models.push(config.modelId);
        }
      }
      return [...new Set(models)];
    } catch (error) {
      this.logger.error(`[getAvailableModelsAsync] Failed: ${error}`);
      return [];
    }
  }

  /**
   * 获取所有已配置的 AI 模型列表（同步，仅检查环境变量）
   *
   * @deprecated 这个方法曾经返回硬编码字面量（"grok"/"gpt-4"/"claude"/"gemini"）
   * 作为"有 key 就算有模型"的粗略信号，但字面量本身不是 DB 中的真实 modelId，
   * 透传下去必然导致"模型未配置"错误。**永远不要用返回值做模型名**——只用来
   * 做"是否有任意 provider 凭证"的布尔判断；要拿真正的 modelId 请用
   * `getAvailableModelsAsync()` 或 `AiModelConfigService.getEnabledModels()`。
   */
  getAvailableProviders(): string[] {
    const providers: string[] = [];
    if (this.configService.get<string>("XAI_API_KEY")) providers.push("xai");
    if (this.configService.get<string>("OPENAI_API_KEY"))
      providers.push("openai");
    if (this.configService.get<string>("ANTHROPIC_API_KEY"))
      providers.push("anthropic");
    if (this.configService.get<string>("GOOGLE_AI_API_KEY"))
      providers.push("google");
    return providers;
  }

  /**
   * @deprecated Use {@link getAvailableProviders} + {@link getAvailableModelsAsync}.
   * Kept only as a thin alias because a handful of legacy callers still
   * destructure the returned array — they should migrate before the next
   * minor release. Never use the returned strings as model ids.
   */
  getAvailableModels(): string[] {
    return this.getAvailableProviders();
  }

  /**
   * 将 AIError.type 字符串映射到 CircuitBreaker 的 TaskCompletionType
   * 当 ChatCompletionResult.errorType 可用时使用，避免字符串解析丢失精度
   */
  private mapAIErrorTypeToTaskCompletion(
    aiErrorType: string,
  ): TaskCompletionType {
    switch (aiErrorType) {
      case "RATE_LIMIT":
      case "QUOTA_EXCEEDED":
        return TaskCompletionType.RATE_LIMITED;
      case "TIMEOUT":
        return TaskCompletionType.TIMEOUT;
      case "INVALID_API_KEY":
      case "INVALID_MODEL":
        return TaskCompletionType.AUTH_ERROR;
      case "CONTENT_FILTERED":
        return TaskCompletionType.CONTENT_ERROR;
      case "CONTEXT_LENGTH_EXCEEDED":
        return TaskCompletionType.CONTEXT_OVERFLOW;
      case "NETWORK_ERROR":
      case "TEMPORARY_UNAVAILABLE":
      default:
        return TaskCompletionType.API_ERROR;
    }
  }

  // ==================== Path A: 系统配置调用 ====================

  /**
   * Generate a chat completion using the specified AI model
   * 优先从数据库获取模型配置，仅在找不到时回退到环境变量
   */
  async generateChatCompletion(
    options: ChatCompletionOptions,
  ): Promise<ChatCompletionResult> {
    const {
      model,
      systemPrompt,
      messages,
      maxTokens = 2048,
      temperature,
      strictMode: optionStrictMode,
      userId,
      responseFormat,
      reasoningDepth,
      cachePolicy,
      outputSchema,
      structuredOutputStrategy,
      outputJsonSchema,
      schemaName,
      tools,
    } = options;

    this.logger.debug(`Generating chat completion with model: ${model}`);

    const fullMessages: ChatMessage[] = [];
    if (systemPrompt) {
      fullMessages.push({ role: "system", content: systemPrompt });
    }
    fullMessages.push(...messages);

    const modelConfig = await this.getModelConfig(model);

    if (modelConfig) {
      this.logger.debug(
        `[generateChatCompletion] Using DB config for model: ${modelConfig.modelId} (provider: ${modelConfig.provider})`,
      );
      return this.callAPIWithConfig(
        modelConfig,
        fullMessages,
        maxTokens,
        temperature,
        optionStrictMode,
        userId,
        responseFormat,
        reasoningDepth,
        cachePolicy,
        outputSchema,
        structuredOutputStrategy,
        outputJsonSchema,
        schemaName,
        tools,
      );
    }

    const errorMsg = `模型 "${model}" 未在数据库中配置，请在管理后台添加该模型的配置`;
    this.logger.error(`[generateChatCompletion] ${errorMsg}`);

    const useStrictMode = optionStrictMode ?? false;
    if (useStrictMode) {
      throw new AiServiceUnavailableError(errorMsg, model);
    }

    // ★ 全覆盖审计修 (2026-05-06): 补 errorType，让 fallback 决策能正确分类
    //   NO_MODEL_CONFIGURED = 模型未在 DB 配置，区别于 INVALID_API_KEY / API 故障
    return {
      content: `**模型未配置**\n\n${errorMsg}\n\n请联系管理员在后台配置该模型。`,
      model,
      tokensUsed: 0,
      isError: true,
      errorType: "NO_MODEL_CONFIGURED",
    };
  }

  /**
   * 使用数据库配置调用 AI API
   * BYOK failover 路径：见 ai-chat-failover-caller.service.ts（2026-05-05 抽出）
   */
  private async callAPIWithConfig(
    config: AIModelConfig,
    messages: ChatMessage[],
    maxTokens: number,
    temperature?: number,
    optionStrictMode?: boolean,
    userId?: string,
    responseFormat?: string,
    reasoningDepth?: import("../types").ReasoningDepth,
    cachePolicy?: "auto",
    outputSchema?: { type: "json_schema"; schema: Record<string, unknown> },
    structuredOutputStrategy?: import("../output/structured/structured-output-strategy.types").StructuredOutputStrategy,
    outputJsonSchema?: Record<string, unknown>,
    schemaName?: string,
    tools?: import("../../tools/abstractions/tool.interface").FunctionDefinition[],
  ): Promise<ChatCompletionResult> {
    const { modelId, apiEndpoint, provider } = config;

    // 2026-05-05 PR-4: userId + failoverCaller 可用 → BYOK failover 链路；否则旧路径
    if (userId && this.failoverCaller?.isAvailable()) {
      return await this.failoverCaller.callAPIWithFailover(
        userId,
        config,
        messages,
        maxTokens,
        temperature,
        optionStrictMode,
        responseFormat,
        reasoningDepth,
        cachePolicy,
        outputSchema,
        structuredOutputStrategy,
        outputJsonSchema,
        schemaName,
        tools,
      );
    }

    const resolved = await this.modelConfigService.resolveApiKey(
      config,
      userId,
    );
    const apiKey = resolved?.apiKey || null;
    const apiKeySource = resolved?.source;
    const effectiveEndpoint = resolved?.apiEndpoint || apiEndpoint;

    const apiFormat = config.apiFormat || "openai";
    // ★ 用 || 而非 ??：DB isReasoning 是 Boolean @default(false) NOT NULL，
    //   "用户漏标"塌缩为 false（非 null），?? 不触发兜底。|| 让 false/undefined
    //   都回退 modelId 启发式，救回被漏标的 reasoning 模型；admin 强制非推理走
    //   显式 tokenParamName=max_tokens（直读、不被覆盖）。
    const isReasoning = config.isReasoning || inferIsReasoning(modelId);
    // ★ reasoning 模型硬性拒绝 temperature（发即 400）。supportsTemperature 列是
    //   Boolean @default(true) NOT NULL，漏标 reasoning 塌缩为 true → ?? 不触发，
    //   故对 reasoning 强制 false（覆盖 DB），非 reasoning 才尊重 config。
    const supportsTemp = isReasoning
      ? false
      : (config.supportsTemperature ?? true);
    const tokenParamName =
      config.tokenParamName ||
      (isReasoning ? "max_completion_tokens" : "max_tokens");

    // ★ Safety clamp: 如果模型配置了 maxTokens 限制，确保请求不超出
    const configLimit = config.maxTokens;
    if (configLimit > 0 && maxTokens > configLimit) {
      this.logger.warn(
        `[callAPIWithConfig] Clamping maxTokens from ${maxTokens} to model limit ${configLimit} for ${modelId}`,
      );
      maxTokens = configLimit;
    }

    // ★ 修复：用 Math.max 而非 || 短路，避免 UserModelConfig.defaultTimeoutMs
    // 默认值 120000（schema @default）让 reasoning model 永远走不到 540s+ 的 timeout 算法。
    // configured 仍允许 admin/用户显式调大，但不会被低于推荐值的旧默认值卡死。
    const computedTimeout = this.modelConfigService.getTimeoutForModel(
      modelId,
      maxTokens,
    );
    const configuredTimeout = config.defaultTimeoutMs ?? 0;
    const timeout = Math.max(computedTimeout, configuredTimeout);

    const useStrictMode = optionStrictMode ?? false;

    if (!apiKey) {
      const errorMsg = `模型 ${modelId} 的 API Key 未配置（直接输入或 Secret Manager 均未找到）`;
      this.logger.error(`[callAPIWithConfig] ${errorMsg}`);
      if (useStrictMode) {
        throw new AiServiceUnavailableError(errorMsg, modelId);
      }
      return {
        content: `**API Key 未配置**\n\n${errorMsg}\n\n请在管理后台配置该模型的 API Key。`,
        model: modelId,
        tokensUsed: 0,
        isError: true,
      };
    }

    const effectiveTemperature = supportsTemp ? temperature : undefined;

    if (!supportsTemp && temperature !== undefined) {
      this.logger.debug(
        `[callAPIWithConfig] Model ${modelId} does not support temperature, ignoring temperature=${temperature}`,
      );
    }

    this.logger.debug(
      `[callAPIWithConfig] Calling API: model=${modelId}, format=${apiFormat}, ` +
        `supportsTemp=${supportsTemp}, isReasoning=${isReasoning}, timeout=${timeout}ms`,
    );

    try {
      const apiCall = async (): Promise<ChatCompletionResult> => {
        switch (apiFormat) {
          case "openai":
            return await this.apiCallerService.callOpenAICompatibleAPI(
              effectiveEndpoint,
              apiKey,
              modelId,
              messages,
              maxTokens,
              effectiveTemperature,
              timeout,
              tokenParamName,
              responseFormat,
              reasoningDepth,
              outputSchema,
              useStrictMode,
              isReasoning,
              structuredOutputStrategy,
              outputJsonSchema,
              schemaName,
              tools,
              provider, // v3.1 §A: ModelCapabilityService 判 nativeMode==='none'
            );

          case "anthropic":
            return await this.apiCallerService.callAnthropicAPI(
              effectiveEndpoint,
              apiKey,
              modelId,
              messages,
              maxTokens,
              effectiveTemperature,
              timeout,
              responseFormat,
              reasoningDepth,
              cachePolicy,
              structuredOutputStrategy,
              outputJsonSchema,
              schemaName,
            );

          case "google":
            return await this.apiCallerService.callGoogleAPI(
              effectiveEndpoint,
              apiKey,
              modelId,
              messages,
              maxTokens,
              effectiveTemperature,
              timeout,
              responseFormat,
              reasoningDepth,
              structuredOutputStrategy,
              outputJsonSchema,
              schemaName,
            );

          case "xai":
            return await this.apiCallerService.callXAIAPI(
              effectiveEndpoint,
              apiKey,
              modelId,
              messages,
              maxTokens,
              effectiveTemperature,
              timeout,
              tokenParamName,
              responseFormat,
              reasoningDepth,
              outputSchema,
              useStrictMode,
              isReasoning,
              structuredOutputStrategy,
              outputJsonSchema,
              schemaName,
              tools,
            );

          case "cohere":
            // Cohere v2 chat（非 OpenAI-compatible）专用 caller；之前落 default
            // 走 OpenAI 格式必挂，是 cohere chat 假动态根因。
            // L2 fix：透传 structured-output（之前丢，schema 请求变自由文本）；
            //   tools 暂不支持原生工具调用，有则告警而非静默丢。
            if (tools && tools.length > 0) {
              this.logger.warn(
                `[chat] Cohere adapter does not support native tool-calling; ${tools.length} tool(s) dropped for model=${modelId}`,
              );
            }
            return await this.apiCallerService.callCohereAPI(
              effectiveEndpoint,
              apiKey,
              modelId,
              messages,
              maxTokens,
              effectiveTemperature,
              timeout,
              responseFormat,
              structuredOutputStrategy,
              outputJsonSchema,
              schemaName,
            );

          default:
            return await this.apiCallerService.callOpenAICompatibleAPI(
              effectiveEndpoint,
              apiKey,
              modelId,
              messages,
              maxTokens,
              effectiveTemperature,
              timeout,
              tokenParamName,
              responseFormat,
              reasoningDepth,
              outputSchema,
              useStrictMode,
              isReasoning,
              structuredOutputStrategy,
              outputJsonSchema,
              schemaName,
              tools,
              provider, // v3.1 §A: ModelCapabilityService 判 nativeMode==='none'
            );
        }
      };

      const result = await this.retryService.withExponentialBackoff(
        apiCall,
        `callAPIWithConfig [${modelId}]`,
        provider,
      );
      result.apiKeySource = apiKeySource;
      return result;
    } catch (error: unknown) {
      const httpErr = error as {
        type?: string;
        response?: { status: number; data: Record<string, unknown> };
      };
      let errorMsg = error instanceof Error ? error.message : String(error);
      let detailedError = "";

      // ★ Preserve AIError type for fallback decisions
      const classifiedErrorType = httpErr.type;

      const status = httpErr.response?.status;
      const data = httpErr.response?.data;
      const apiErrorPayload = data?.error as
        | { message?: string; code?: string; type?: string }
        | undefined;
      const apiErrorMsg =
        apiErrorPayload?.message || (data?.message as string) || "";

      if (status !== undefined) {
        detailedError = `Status: ${status}, API Error: ${
          apiErrorMsg || JSON.stringify(data)
        }`;
        errorMsg = `${errorMsg} - ${detailedError}`;
      }

      this.logger.error(
        `[callAPIWithConfig] ${provider} API error for ${modelId}: ${errorMsg}`,
      );

      this.logger.debug(
        `[callAPIWithConfig] Failed request params - model: ${modelId}, endpoint: ${effectiveEndpoint?.substring(0, 50)}..., keySource: ${apiKeySource}`,
      );

      // ★ BYOK：用户自己的 Key 或管理员分配的 Key 被 Provider 拒绝时，
      // 抛成特定的 BYOKError，让 HTTP 层返回 403 + code，前端全局
      // Modal 弹出引导卡片，而不是把错误文本当 AI 回复渲染。
      // source === "system" 时（管理员走系统 Secret）保留原有的 isError 行为。
      const isUserScopedKey =
        apiKeySource === "personal" || apiKeySource === "assigned";
      const source =
        apiKeySource === "personal"
          ? "PERSONAL"
          : apiKeySource === "assigned"
            ? "ASSIGNED"
            : "SYSTEM";

      if (isUserScopedKey && status !== undefined) {
        const isAuthError =
          status === 401 ||
          apiErrorPayload?.code === "invalid_api_key" ||
          apiErrorPayload?.type === "invalid_request_error";
        const isQuotaError =
          status === 429 ||
          apiErrorPayload?.code === "insufficient_quota" ||
          /quota|billing|exceeded/i.test(apiErrorMsg);

        if (isAuthError && !isQuotaError) {
          throw new InvalidApiKeyError(provider, source, {
            meta: { providerMessage: apiErrorMsg, status },
          } as never);
        }
        if (isQuotaError) {
          throw new QuotaExceededError(provider, source, {
            providerMessage: apiErrorMsg,
            status,
          } as never);
        }
      }

      if (useStrictMode) {
        throw error;
      }

      return {
        content: `**${provider} API 调用失败**\n\n模型：${modelId}\n错误信息：${errorMsg}\n\n请稍后重试或检查 API 配置。`,
        model: modelId,
        tokensUsed: 0,
        isError: true,
        errorType: classifiedErrorType,
      };
    }
  }

  // ==================== 委托给提取的子服务 ====================

  /**
   * Test connection to an AI model with custom API key and endpoint
   * 委托给 AiConnectionTestService
   */
  async testModelConnectionWithKey(
    provider: string,
    modelId: string,
    apiKey: string,
    apiEndpoint: string,
    modelType?: string,
  ): Promise<{ success: boolean; message: string; latency?: number }> {
    if (this.connectionTestService) {
      return this.connectionTestService.testModelConnectionWithKey(
        provider,
        modelId,
        apiKey,
        apiEndpoint,
        modelType,
      );
    }
    return {
      success: false,
      message: "AiConnectionTestService not available",
    };
  }

  /**
   * Generate a chat completion using a specific API key
   * 委托给 AiDirectKeyService
   */
  async generateChatCompletionWithKey(options: {
    provider: string;
    modelId: string;
    apiKey: string;
    apiEndpoint?: string;
    systemPrompt?: string;
    messages: ChatMessage[];
    taskProfile?: TaskProfile;
    maxTokens?: number;
    temperature?: number;
    displayName?: string;
    capabilities?: string[];
    enableSearch?: boolean;
    responseFormat?: string;
  }): Promise<ChatCompletionResult> {
    if (this.directKeyService) {
      return this.directKeyService.generateChatCompletionWithKey(options);
    }
    return {
      content: "AiDirectKeyService not available",
      model: options.modelId,
      tokensUsed: 0,
      isError: true,
    };
  }

  /**
   * Check if the user message is requesting image generation
   * 委托给 AiImageGenerationService
   */
  isImageGenerationRequest(content: string): boolean {
    if (this.imageGenerationService) {
      return this.imageGenerationService.isImageGenerationRequest(content);
    }
    return false;
  }

  /**
   * Format a model ID into a user-friendly display name
   * 委托给 AiModelDiscoveryService
   */
  formatModelDisplayName(model: string): string {
    if (this.modelDiscoveryService) {
      return this.modelDiscoveryService.formatModelDisplayName(model);
    }
    return model;
  }

  /**
   * Get the environment variable name for a provider's API key
   * 委托给 AiModelDiscoveryService
   */
  getEnvVarNameForProvider(provider: string): string {
    if (this.modelDiscoveryService) {
      return this.modelDiscoveryService.getEnvVarNameForProvider(provider);
    }
    return `${provider.toUpperCase()}_API_KEY`;
  }

  /**
   * Fetch available models from a provider's API
   * 委托给 AiModelDiscoveryService
   */
  async fetchAvailableModels(
    provider: string,
    apiKey: string,
    apiEndpoint?: string,
    modelType?: string,
  ): Promise<{
    success: boolean;
    models?: Array<{ id: string; name: string; description?: string }>;
    error?: string;
  }> {
    if (this.modelDiscoveryService) {
      return this.modelDiscoveryService.fetchAvailableModels(
        provider,
        apiKey,
        apiEndpoint,
        modelType,
      );
    }
    return {
      success: false,
      error: "AiModelDiscoveryService not available",
    };
  }

  // ==================== Observer pattern（chat 调用观察）====================

  /**
   * 注册 chat 调用观察者。
   *
   * 返回一个 dispose 函数；调用 dispose 等同于 `removeChatObserver(fn)`。
   * 典型消费者：Topic Insights baseline 录制（通过 MissionContext.missionId 过滤）。
   */
  addChatObserver(fn: ChatObserver): () => void {
    this.chatObservers.add(fn);
    return () => this.chatObservers.delete(fn);
  }

  removeChatObserver(fn: ChatObserver): boolean {
    return this.chatObservers.delete(fn);
  }

  private dispatchChatObservers(event: ChatObserverEvent): void {
    if (this.chatObservers.size === 0) return;
    for (const observer of this.chatObservers) {
      try {
        observer(event);
      } catch (err) {
        this.logger.warn(
          `[chat] Observer threw: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  // ==================== 统一入口 ====================

  /**
   * ★ 统一 chat 入口（公共）— BYOK 模型级 failover 总闸。
   *
   * 所有直调 chat() 的服务（wiki-ingest / leader-chat / 未来任何服务）走的
   * 单一入口：当 caller **没有显式指定 model**（即走 modelType → 用户默认模型
   * 的路径）且有 userId 时，若默认模型所属 provider 失败（无 key / key 失效 /
   * quota 用尽 / 5xx / 超时 / 模型不存在 …），自动改用用户的下一个可用模型重试。
   *
   * 行为保持原样的两条短路：
   * 1. caller 显式传了 `model`（自己控制模型，如 ReAct loop 已在做 failover）
   *    → 直接走 `chatOnce`，本层不做 failover（避免与 loop 层重复 failover）。
   * 2. 无 userId（拿不到 BYOK 候选）→ 直接走 `chatOnce` 单次。
   *
   * 真正的执行逻辑全部在 `chatOnce`（原 `chat`，方法体未改）。
   */
  async chat(options: ChatOptions): Promise<ChatResult> {
    const userId = options.userId ?? RequestContext.getUserId();
    // 短路：显式指定模型（caller 自管 failover，如 ReAct loop）或无 userId →
    // 保持原行为，单次 chatOnce，不在本层做 failover（避免与 loop 层重复）。
    if (options.model || !userId) {
      return this.chatOnce(options);
    }
    // BYOK + 走 modelType→默认模型路径 → 模型级 failover（逻辑见
    // chat-model-failover.util，避免 god-class 膨胀）。
    return runChatWithModelFailover(options, userId, {
      chatOnce: (o) => this.chatOnce(o),
      modelConfigService: this.modelConfigService,
    });
  }

  /**
   * ★ 单次 chat 执行（原 `chat`，方法体未改，仅改名 + 私有化）。
   * AI App 可以通过两种方式指定模型：
   * 1. model: 直接指定模型 ID
   * 2. modelType: 指定模型类型，由 AI Engine 选择具体模型（推荐）
   *
   * 本方法是 thin wrapper：委托 `chatInner` 执行，并在 `finally` 调用观察者。
   * Observer 故障不影响主流程返回。
   */
  private async chatOnce(options: ChatOptions): Promise<ChatResult> {
    // ★ 2026-05-11 [BYOK ctx propagation] 显式 options.userId 必须在异步链路
    //   全程可见。chatLegacy 已合并 options.userId + RequestContext.getUserId()，
    //   但下游 getModelConfig → findUserModelConfigByModelId / synthesizeConfigForUserModel
    //   只读 RequestContext.getUserId()（不接受 userId 参数透传）。Cron / async
    //   path 里 RequestContext 是空的 → 用户 UserModelConfig 里自定义的模型
    //   找不到 → 误报"未在数据库中配置"。在入口用 withUserContext 兜底设置。
    //   已有上下文（HTTP 请求链路）不覆盖。
    const ctxUserId = RequestContext.getUserId();

    // 2026-05-12 BYOK contract：mission 路径走 MissionContext.run({ missionId,
    //   userId })，但 MissionContext / RequestContext 是分离的 AsyncLocalStorage，
    //   chat() 之前只看 RequestContext → mission 内任何忘传 options.userId 的
    //   caller 都会退化到 admin pool。
    //
    //   修法：chat() 入口把 MissionContext.userId 作为 effectiveUserId 第三兜底；
    //   missionId 存在但 effectiveUserId 解不到时 logger.error 形成"contract
    //   violation"信号，方便监控+排查（不 throw，保持非破坏性）。
    const kctx = MissionContext.get();
    const kctxUserId = kctx?.userId;
    const effectiveUserId =
      options.userId ?? ctxUserId ?? kctxUserId ?? undefined;

    if (kctx?.missionId && !effectiveUserId) {
      this.logger.error(
        `[chat] BYOK contract violation: MissionContext.missionId=${kctx.missionId} ` +
          `但 effectiveUserId 解析为空（options.userId / RequestContext / MissionContext.userId 都 null）` +
          `→ 后续模型解析会退化到 admin pool，BYOK 失效。` +
          `caller 必须 explicit 传 options.userId 或在 MissionContext.run 里塞 userId。` +
          `operationName=${options.operationName ?? "unknown"}`,
      );
    }

    // userId 来自 MissionContext 但不在 RequestContext 里 → 也走 withUserContext
    //   兜底，让下游 RequestContext-only 读取的路径（getModelConfig /
    //   findUserModelConfigByModelId 等）都能看到 userId
    if (effectiveUserId && !ctxUserId) {
      return withUserContext(effectiveUserId, () =>
        this.chatRaceWrapped({ ...options, userId: effectiveUserId }),
      );
    }
    return this.chatRaceWrapped(options);
  }

  private async chatRaceWrapped(options: ChatOptions): Promise<ChatResult> {
    // ★ 2026-05-05 [task #22 机制根因] 强制 wall-time race
    //   截图 12 真因：mission 卡 S4 30+ 分钟。链路：ReAct loop wall-time check
    //   只在 iteration 开始时做（react-loop.ts:338）→ LLM await hang 期间
    //   loop 永远到不了下个 check → 5 min agent wall-time 失效 → mission hang。
    //   ai-api-caller 的 axios timeout 在 server 持续返空 chunk 时也不重置。
    //
    //   机制性修复：在 chat() 入口包 Promise.race + 独立 setTimeout。无论
    //   axios / streaming / event loop 如何，强制 N 秒后 reject。N = (axios
    //   timeout 上限 + 60s 安全边际)，对 reasoning 模型 = 16min，对普通模型
    //   = 11min。LLM 真卡死时整个 stage 抛错让 dispatcher 进入 handleMissionFailure。
    const HARD_TIMEOUT_MS = 16 * 60_000;
    const inner: Promise<ChatResult> = this.hookBus
      ? this.chatWithHooks(options)
      : this.chatLegacy(options);
    let raceTimer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        inner,
        new Promise<never>((_, reject) => {
          raceTimer = setTimeout(() => {
            reject(
              new Error(
                `[chat] hard timeout after ${HARD_TIMEOUT_MS}ms (LLM hang detected — likely server returning empty chunks or infinite reasoning)`,
              ),
            );
          }, HARD_TIMEOUT_MS);
          (raceTimer as { unref?: () => void }).unref?.();
        }),
      ]);
    } finally {
      if (raceTimer) clearTimeout(raceTimer);
    }
  }

  /** v5.1 PR-5: 双轨期 hook 包装路径 */
  private async chatWithHooks(options: ChatOptions): Promise<ChatResult> {
    const meta = {
      missionId: MissionContext.get()?.missionId,
      agentId: MissionContext.get()?.agentId,
      timestamp: Date.now(),
    };
    const requestPayload: LlmRequestPayload = {
      __version: 1,
      request: this.toJsonSafe({
        messages: options.messages,
        systemPrompt: options.systemPrompt,
        modelType: options.modelType,
        taskProfile: options.taskProfile,
      }),
      meta,
    };

    try {
      return await this.hookBus!.fire(
        CORE_HOOKS.LLM_REQUEST,
        requestPayload,
        async () => {
          const r = await this.chatLegacy(options);
          const responsePayload: LlmResponsePayload = {
            __version: 1,
            request: requestPayload.request,
            raw: this.toJsonSafe(r),
            tokensUsed: (r as { tokensUsed?: number }).tokensUsed,
            meta: { ...meta, timestamp: Date.now() },
          };
          return this.hookBus!.fire(
            CORE_HOOKS.LLM_RESPONSE,
            responsePayload,
            async () => r,
          );
        },
      );
    } catch (err) {
      // HIGH-3: cache-hit abort 仍 fire LLM_RESPONSE
      if (err instanceof HookAbortError) {
        if (err.reason === "cache-hit" && err.abortPayload) {
          const cached = err.abortPayload as ChatResult;
          const cachedResp: LlmResponsePayload = {
            __version: 1,
            request: requestPayload.request,
            raw: this.toJsonSafe(cached),
            cacheHit: true,
            meta: { ...meta, timestamp: Date.now() },
          };
          await this.hookBus!.fire(
            CORE_HOOKS.LLM_RESPONSE,
            cachedResp,
            async () => cached,
          ).catch(() => undefined);
          return cached;
        }
      }
      throw err;
    }
  }

  /** PR-5: 保留旧实现（observer dispatch 不变）*/
  private async chatLegacy(options: ChatOptions): Promise<ChatResult> {
    const startedAt = Date.now();
    let result: ChatResult | undefined;
    let error: Error | undefined;
    try {
      result = await this.chatInner(options);
      return result;
    } catch (e) {
      error = e instanceof Error ? e : new Error(String(e));
      throw e;
    } finally {
      this.dispatchChatObservers({
        options,
        result,
        error,
        durationMs: Date.now() - startedAt,
        missionContext: MissionContext.get(),
      });
    }
  }

  /**
   * v5.1 PR-5: 启动期注入 HookBus（plugins/core NestJS module 在
   * onApplicationBootstrap 时调用；未调用时 chat() 走 chatLegacy 旧逻辑）
   */
  private hookBus: HookBus | undefined;

  setHookBus(bus: HookBus | undefined): void {
    this.hookBus = bus;
  }

  /** payload 序列化辅助 */
  private toJsonSafe(obj: unknown): unknown {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj !== "object") return obj;
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch {
      return undefined;
    }
  }

  /**
   * Chat 主逻辑（原 `chat` 方法 body）
   * 拆分动机：外层 `chat()` 负责 observer dispatch，本方法保持单一职责。
   */
  private async chatInner(options: ChatOptions): Promise<ChatResult> {
    // ★ AbortSignal fast-path check
    if (options.signal?.aborted) {
      throw new DOMException("AiChatService.chat aborted", "AbortError");
    }
    const {
      messages,
      systemPrompt,
      taskProfile,
      maxTokens: providedMaxTokens,
      temperature: providedTemperature,
      model: providedModel,
      modelType,
      strictMode,
      provider,
      apiKey,
      apiEndpoint,
      displayName,
      capabilities,
      enableSearch,
      userId: rawUserId,
      traceId,
      responseFormat,
      processId: explicitProcessId,
      skipGuardrails,
      trustedInternal,
      cachePolicy,
      outputSchema,
      structuredOutputStrategy,
      outputJsonSchema,
      schemaName,
      sharedCachePrefix,
      tools,
    } = options;

    // ★ BYOK v2 防呆：普通路径必须有 userId（来自参数或 RequestContext）。
    // 直连路径（BYOK direct，apiKey+provider 都显式传入）豁免，因为它自带 Key 不走 Resolver。
    // 异步任务 / Cron 漏写 withUserContext 时会在这里被立即拦截，而非静默走系统 Secret。
    //
    // ★★ 关键：把 options.userId 和 RequestContext.userId 合并到 `userId` 后再往下游传，
    //    否则"参数没传但 middleware 已经设 ctx"的调用链会让下游 resolveApiKey 拿到 undefined，
    //    进入过渡路径误用系统 Secret。
    const isDirectBYOKPath = !!(apiKey && provider);
    const ctxUserId = RequestContext.getUserId();
    const userId: string | undefined = rawUserId ?? ctxUserId;
    if (!isDirectBYOKPath && !userId) {
      this.logger.error(
        "[chat] Refused: no userId in params nor RequestContext. " +
          "Async tasks must wrap the call in withUserContext(userId, ...) " +
          "so KeyResolver can route to PERSONAL/ASSIGNED. " +
          "★ 2026-05-05 严格 BYOK：所有用户（含 ADMIN）必须配 BYOK，不再 fallback SYSTEM。",
      );
      throw new UnauthorizedException(
        "BYOK v2: userId is required. Wrap async calls in withUserContext.",
      );
    }

    // ★ MissionContext: fallback to AsyncLocalStorage if processId not explicitly provided.
    //   2026-05-11: reads renamed `agentProcessId` slot — only set when caller
    //   actually spawned an AgentProcess via MissionExecutor.execute(). When
    //   undefined, downstream emitJournalRecord is skipped (`if (processId)`),
    //   so non-kernel mission paths no longer trigger EventJournal FK 23503.
    const processId = explicitProcessId ?? MissionContext.getAgentProcessId();

    // ★ Observability: Start trace span
    let spanId: string | undefined;
    if (traceId) {
      spanId = this.emitSpanStart(traceId, {
        name: "ai-chat",
        type: "llm_call",
        metadata: {
          modelType,
          providedModel,
          messageCount: messages.length,
          hasSystemPrompt: !!systemPrompt,
          hasTaskProfile: !!taskProfile,
        },
      });
    }

    // ★ 路径分叉：如果提供了 apiKey，使用直接 API 调用路径 (Path B)
    if (apiKey && provider) {
      if (!this.directKeyService) {
        this.logger.error(
          "[chat] Path B (BYOK) requested but AiDirectKeyService not available",
        );
        return {
          content:
            "BYOK (Bring Your Own Key) feature is not available. Please contact administrator.",
          model: providedModel || "unknown",
          usage: { totalTokens: 0 },
          isError: true,
        };
      }
      this.logger.debug(
        `[chat] Using direct API key path for provider: ${provider}`,
      );

      // ★ Guardrails: Input validation for BYOK path (skip for internal system calls)
      // ★ PII 脱敏：默认用原 messages，命中 PII 时换成脱敏后的 messages 再发 provider。
      let byokMessages = messages;
      if (!skipGuardrails) {
        const inputGuardrailResult = await this.runInputGuardrails(messages, {
          provider,
          modelId: providedModel,
          spanId,
          pathName: "BYOK",
          trustedInternal,
        });
        if (!inputGuardrailResult.passed) {
          return {
            content: `Request blocked by content safety guardrail: ${inputGuardrailResult.blockedBy}`,
            model: providedModel || "unknown",
            usage: { totalTokens: 0 },
            isError: true,
          };
        }
        if (inputGuardrailResult.redactedMessages) {
          byokMessages = inputGuardrailResult.redactedMessages;
        }
      }

      try {
        const result = await this.generateChatCompletionWithKey({
          provider,
          modelId: providedModel || "default",
          apiKey,
          apiEndpoint,
          systemPrompt,
          messages: byokMessages,
          taskProfile,
          maxTokens: providedMaxTokens,
          temperature: providedTemperature,
          displayName,
          capabilities,
          enableSearch,
          responseFormat,
        });

        // ★ Guardrails: Output validation for BYOK path (skip for internal system calls)
        if (!skipGuardrails && !result.isError) {
          const outputGuardrailResult = await this.runOutputGuardrails(
            result.content,
            result.model,
            {
              spanId,
              tokensUsed: result.tokensUsed,
              pathName: "BYOK",
            },
          );
          if (!outputGuardrailResult.passed) {
            return {
              content: "Response filtered by content safety guardrail",
              usage: { totalTokens: result.tokensUsed },
              model: result.model,
              isError: true,
            };
          }
          // ★ PII 脱敏：输出含 PII 时用脱敏后的内容替换再返回用户。
          if (outputGuardrailResult.redactedContent) {
            result.content = outputGuardrailResult.redactedContent;
          }
        }

        // ★ Observability: End trace span
        if (spanId) {
          this.emitSpanEnd(spanId, {
            status: result.isError ? "error" : "success",
            output: {
              model: result.model,
              tokensUsed: result.tokensUsed,
            },
          });
        }

        return {
          content: result.content,
          usage: {
            totalTokens: result.tokensUsed,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            cacheCreationTokens: result.cacheCreationTokens,
            cacheReadTokens: result.cacheReadTokens,
          },
          model: result.model,
          finishReason: result.finishReason,
          reasoning: result.reasoning,
          isError: result.isError,
        };
      } catch (error) {
        // ★ Observability: End trace span on error
        if (spanId) {
          this.emitSpanEnd(spanId, {
            status: "error",
            error: error instanceof Error ? error.message : String(error),
          });
        }
        throw error;
      }
    }

    // ★ Path A: 系统配置调用
    //
    // 与 pickBYOKModelForUser 的关系（2026-05-12 PR-3 文档化）：
    // 本路径在选模型阶段实质等价 pickBYOKModelForUser，但保留更细粒度语义：
    //   1) findUserDefaultByType（UserModelConfig PERSONAL BYOK）—— pick 的步骤 1
    //   2) getDefaultModelByType + availableProviders 过滤 —— pick 的步骤 2
    //      （pick 是直接查 KeyAssignment + provider 过滤；这里是 admin 默认模型
    //        命中用户 provider 失败时再换，保留 retry-blacklist 等 chat 特化语义）
    //   3) 都没命中 throw NoAvailableKeyError —— 与 pick 一致
    // 所以"chat 主路径不走 pickBYOKModelForUser"是命名差异不是合规缺口；
    // refactor 风险（god class）大于收益。后续如需统一，应让 pickBYOKModelForUser
    // 支持 retry blacklist 后再切换。
    let model: string;
    let modelConfig: AIModelConfig | null = null;

    // ★ BYOK v2：按用户可用 provider 过滤，保证初始模型选择就命中用户有 Key 的 provider。
    // 管理员 / BYOK 直连 / 无 userId 的老路径不过滤。
    const effectiveUserIdForInitial = userId ?? RequestContext.getUserId();
    let userAvailableProviders: Set<string> | null = null;
    if (effectiveUserIdForInitial && this.keyResolver && !isDirectBYOKPath) {
      try {
        const list = await this.keyResolver.getAvailableProviders(
          effectiveUserIdForInitial,
        );
        userAvailableProviders = new Set(list.map((p) => p.toLowerCase()));
        // ★ 预检：普通用户一个 provider 都没配（Personal 空 + 无 ACTIVE Assignment）
        // 时，提前抛 NoAvailableKeyError，让前端拿到明确错误码「NO_AVAILABLE_KEY」
        // 并引导到 /settings/api-keys。
        // 管理员的 availableProviders 来自系统 Secret，极少为空；即便为空也应让
        // resolveSystemKey 抛 NoSystemKeyError 以区分语义。
        //
        // 错误里不传具体 provider（传空字符串）—— 这种场景是「用户一个 Key 都没配」，
        // 不指向特定 provider；前端 ByokErrorCard 会显示"该 Provider"/"any Provider"。
        if (userAvailableProviders.size === 0) {
          throw new NoAvailableKeyError("");
        }
      } catch (error) {
        if (error instanceof BYOKError) throw error;
        this.logger.warn(
          `[chat] getAvailableProviders for initial selection failed: ${(error as Error).message}`,
        );
      }
    }

    // ★ 2026-05-21 Capability Contract（单一权威 · Resolve）：把请求的 modelType
    //   （用途）按 downgradePolicy 解析成"有效 modelType"。quality-first（默认）下
    //   成本降级 tier（CHAT_FAST）回退到主模型（CHAT），根治"配了 grok-4 却用
    //   grok-3-mini"。只作用于 modelType 路径；providedModel（显式模型）与 BYOK
    //   直连路径不受影响。★ downgradePolicy 提到函数级，保证初选 + 失败 fallback 池
    //   查询都用 effectiveModelType（否则 fallback 会退回 CHAT_FAST 池，重现 bug）。
    const downgradePolicy = normalizeDowngradePolicy(
      this.configService.get<string>("MODEL_DOWNGRADE_POLICY", ""),
    );

    let userDefaultHit = false;
    if (providedModel) {
      model = providedModel;
      modelConfig = await this.getModelConfig(model);
    } else if (modelType) {
      const effectiveModelType = resolveEffectiveModelType(
        modelType,
        downgradePolicy,
      );
      if (effectiveModelType !== modelType) {
        this.logger.log(
          `[model-policy] requested=${modelType} → effective=${effectiveModelType} (policy=${downgradePolicy})`,
        );
      }

      // ★ BYOK v3：如果用户有 UserModelConfig 里设为 default 的同类型模型，
      //   直接用用户的。跳过全局默认的 provider 过滤逻辑。
      if (effectiveUserIdForInitial && !isDirectBYOKPath) {
        const userDefault = await this.modelConfigService
          .findUserDefaultByType(effectiveUserIdForInitial, effectiveModelType)
          .catch(() => null);
        if (userDefault) {
          modelConfig = userDefault;
          model = userDefault.modelId;
          userDefaultHit = true;
          this.logger.log(
            `[chat] Using user default for ${effectiveModelType}: ${model} (${userDefault.provider})`,
          );
        }
      }

      // 没有用户自定义默认 → 走全局默认，再用 availableProviders 过滤
      if (!modelConfig) {
        modelConfig = await this.getDefaultModelByType(effectiveModelType);
        if (
          modelConfig &&
          userAvailableProviders &&
          userAvailableProviders.size > 0 &&
          !userAvailableProviders.has(modelConfig.provider.toLowerCase())
        ) {
          const pool =
            await this.modelConfigService.getAllEnabledModelsByType(
              effectiveModelType,
            );
          const filtered = pool.filter((m) =>
            userAvailableProviders.has(m.provider.toLowerCase()),
          );
          if (filtered.length > 0) {
            modelConfig = filtered[0];
            this.logger.log(
              `[chat] Default ${effectiveModelType} model (${(await this.getDefaultModelByType(effectiveModelType))?.provider}) not in user availableProviders; using ${modelConfig.modelId} (${modelConfig.provider}) instead`,
            );
          }
        }
      }

      if (modelConfig) {
        model = modelConfig.modelId;
        this.logger.debug(
          `[chat] Using ${effectiveModelType} model from database: ${model}`,
        );
      } else {
        // ★ 2026-06-12: 非 CHAT 类型（EVALUATOR / CHAT_FAST 等）无配置时，回落到
        //   CHAT 主模型再用，而不是直接抛错让上层弃权（abstain）。CHAT 是基线类型、
        //   必有配置；这让外部质量评审 / 快评在未单独配 EVALUATOR/CHAT_FAST 模型时
        //   仍能用同一 CHAT 模型工作，而非静默失效（日志实测 judge:external abstain）。
        //   上层（JudgeService 等）注释一直承诺"未配置则回落 CHAT"，此处补齐实现。
        let chatFallbackModelId: string | undefined;
        if (effectiveModelType !== AIModelType.CHAT) {
          const chatFallback = await this.getDefaultModelByType(
            AIModelType.CHAT,
          );
          if (chatFallback) {
            modelConfig = chatFallback;
            chatFallbackModelId = chatFallback.modelId;
            this.logger.warn(
              `[chat] No ${effectiveModelType} model configured — falling back to CHAT model ${chatFallback.modelId} (${chatFallback.provider})`,
            );
          }
        }
        if (chatFallbackModelId) {
          model = chatFallbackModelId;
        } else {
          // 仍无（连 CHAT 都没配）→ DO NOT fall back to a hard-coded string like
          // "gemini". Honour DEFAULT_AI_MODEL only when operators explicitly set it.
          const envDefault = this.configService.get<string>(
            "DEFAULT_AI_MODEL",
            "",
          );
          if (!envDefault) {
            throw new AiServiceUnavailableError(
              `AI 服务不可用：没有可用的 ${effectiveModelType} 模型。请在数据库中启用至少 1 个该用途的模型，或设置 DEFAULT_AI_MODEL 环境变量。`,
              "",
            );
          }
          model = envDefault;
          this.logger.warn(
            `[chat] No ${effectiveModelType} model found, falling back to DEFAULT_AI_MODEL=${model}`,
          );
        }
      }
    } else {
      model = this.configService.get<string>("DEFAULT_AI_MODEL", "");
      if (!model) {
        throw new AiServiceUnavailableError(
          "AI 服务不可用：DEFAULT_AI_MODEL 未设置且未指定 modelType/modelId。",
          "",
        );
      }
      modelConfig = await this.getModelConfig(model);
    }

    // ★ BYOK v2（向后兼容）：用户只设了 UserApiKey.preferredModelId 但
    // 没建 UserModelConfig 时的 override。UserModelConfig（v3）若已命中则
    // 跳过 —— v3 优先级高于 v2。providedModel 显式指定时也不覆盖。
    if (
      !providedModel &&
      !userDefaultHit &&
      !isDirectBYOKPath &&
      effectiveUserIdForInitial &&
      this.keyResolver &&
      modelConfig
    ) {
      try {
        const preferredModelId =
          await this.keyResolver.getPreferredModelIdForProvider(
            effectiveUserIdForInitial,
            modelConfig.provider,
          );
        if (preferredModelId && preferredModelId !== modelConfig.modelId) {
          const preferredConfig = await this.getModelConfig(preferredModelId);
          if (preferredConfig) {
            this.logger.log(
              `[chat] Using user preferredModelId=${preferredModelId} ` +
                `(provider=${modelConfig.provider}) over default ${modelConfig.modelId}`,
            );
            modelConfig = preferredConfig;
            model = preferredConfig.modelId;
          } else {
            this.logger.warn(
              `[chat] User preferredModelId=${preferredModelId} cannot be ` +
                `resolved (no DB record and synthesis failed), keeping default ${modelConfig.modelId}`,
            );
          }
        }
      } catch (error) {
        this.logger.warn(
          `[chat] Failed to resolve user preferredModelId: ${(error as Error).message}`,
        );
      }
    }

    // ★ 参数解析优先级链
    let effectiveMaxTokens: number;
    let effectiveTemperature: number;
    let effectiveReasoningDepth: import("../types").ReasoningDepth | undefined;

    if (providedMaxTokens !== undefined || providedTemperature !== undefined) {
      effectiveMaxTokens = providedMaxTokens ?? modelConfig?.maxTokens ?? 4096;
      effectiveTemperature =
        providedTemperature ?? modelConfig?.temperature ?? 0.7;

      this.logger.debug(
        `[chat] Using direct parameters: temp=${effectiveTemperature}, maxTokens=${effectiveMaxTokens}`,
      );
    } else if (taskProfile) {
      const mappedParams = this.taskProfileMapper.mapToParameters(
        taskProfile,
        modelConfig,
      );
      effectiveMaxTokens = mappedParams.maxTokens;
      effectiveTemperature = mappedParams.temperature;
      effectiveReasoningDepth = mappedParams.reasoningDepth;

      this.logger.debug(
        `[chat] TaskProfile mapped: ${JSON.stringify(taskProfile)} → ` +
          `temp=${effectiveTemperature}, maxTokens=${effectiveMaxTokens}`,
      );
    } else {
      const defaultParams = this.taskProfileMapper.mapToParameters(
        undefined,
        modelConfig,
      );
      effectiveMaxTokens = defaultParams.maxTokens;
      effectiveTemperature = defaultParams.temperature;

      this.logger.debug(
        `[chat] Using model defaults: temp=${effectiveTemperature}, maxTokens=${effectiveMaxTokens}`,
      );
    }

    this.logger.debug(
      `[chat] Final: model=${model}, maxTokens=${effectiveMaxTokens}, ` +
        `temperature=${effectiveTemperature}, isReasoning=${modelConfig?.isReasoning ?? false}`,
    );

    // ★ Guardrails: Input validation (skip for internal system calls)
    // ★ PII 脱敏：默认用原 messages，命中 PII 时换成脱敏后的 messages 再发 provider。
    let effectiveMessages = messages;
    if (!skipGuardrails) {
      const inputGuardrailResult = await this.runInputGuardrails(messages, {
        modelType,
        model,
        spanId,
        pathName: "Standard",
        trustedInternal,
      });
      if (!inputGuardrailResult.passed) {
        return {
          content: `Request blocked by content safety guardrail: ${inputGuardrailResult.blockedBy}`,
          model,
          usage: { totalTokens: 0 },
          isError: true,
        };
      }
      if (inputGuardrailResult.redactedMessages) {
        effectiveMessages = inputGuardrailResult.redactedMessages;
      }
    }

    // ★ sharedCachePrefix: override system prompt + force caching when a frozen prefix is provided
    const effectiveSystemPrompt =
      sharedCachePrefix?.systemPromptText ?? systemPrompt;
    const effectiveCachePolicy: "auto" | undefined = sharedCachePrefix
      ? "auto"
      : cachePolicy;

    // ★ Fallback 机制
    const triedModelIds: string[] = [];
    let lastError: string | null = null;
    let currentModel = model;
    let currentModelConfig = modelConfig;

    const maxFallbackAttempts = 5;

    for (let attempt = 0; attempt < maxFallbackAttempts; attempt++) {
      triedModelIds.push(currentModel);

      this.logger.debug(
        `[chat] Attempt ${attempt + 1}/${maxFallbackAttempts}: trying model ${currentModel}`,
      );

      const startTime = Date.now();
      const result = await this.generateChatCompletion({
        model: currentModel,
        systemPrompt: effectiveSystemPrompt,
        messages: effectiveMessages,
        maxTokens: effectiveMaxTokens,
        temperature: effectiveTemperature,
        strictMode,
        userId,
        responseFormat,
        reasoningDepth: effectiveReasoningDepth,
        cachePolicy: effectiveCachePolicy,
        outputSchema,
        structuredOutputStrategy,
        outputJsonSchema,
        schemaName,
        tools,
      });
      const duration = Date.now() - startTime;

      this.recordLLMMetrics({
        modelId: currentModel,
        providerId: currentModelConfig?.provider,
        userId,
        duration,
        totalTokens: result.tokensUsed,
        success: !result.isError,
        errorCode: result.isError ? "LLM_CALL_FAILED" : undefined,
        errorMsg: result.isError ? result.content.substring(0, 500) : undefined,
      });

      // ★ P0-LIVE-MODEL-EMPTY (2026-04-30): 检测"假成功"——HTTP 200 但 content 为空。
      //   实测 gpt-5.4 (model_id 在 OpenAI 上不存在或 reasoning model 内部 CoT
      //   吃光 max_completion_tokens) 立即 finalize 空 JSON / 空字符串 / null，
      //   不触发 isError → fallback chain 不跑 → researcher / analyst / writer
      //   被 LLM 假成功反复喂空 output → maxIterations runaway / verifier 评分极低。
      //   把"非 error 但 content 实质为空"强制升级为 LLM_EMPTY_RESPONSE，触发 fallback。
      const trimmedContent = (result.content ?? "").trim();
      const looksEmptyJson =
        trimmedContent === "" ||
        trimmedContent === "{}" ||
        trimmedContent === "[]" ||
        trimmedContent === "null" ||
        trimmedContent === '""';
      const noOutputProduced =
        !result.isError &&
        looksEmptyJson &&
        (result.tokensUsed ?? 0) > 0 &&
        // reasoning model 完全没吐 visible content（completion>0 但 thinking 也 0
        // 表示 model_id 大概率不存在或被服务端拒），或 普通 model 直接吐空
        result.finishReason !== "tool_calls"; // tool_calls 走另外路径，不算空
      if (noOutputProduced) {
        this.logger.warn(
          `[chat] Model ${currentModel} returned empty content despite tokensUsed=${result.tokensUsed} ` +
            `(finishReason=${result.finishReason ?? "unknown"}). Treating as LLM_EMPTY_RESPONSE → triggering fallback.`,
        );
        result.isError = true;
        result.errorType = "LLM_EMPTY_RESPONSE" as never;
        result.content =
          `Model "${currentModel}" returned empty content (tokensUsed=${result.tokensUsed}, ` +
          `finishReason=${result.finishReason ?? "unknown"}). ` +
          `Likely cause: model_id not recognized by provider, reasoning CoT exhausted max_completion_tokens, ` +
          `or BYOK key mismatch. Will fall back to next available model.`;
      }

      if (!result.isError) {
        // ★ Circuit Breaker: Record success
        if (this.circuitBreaker) {
          this.circuitBreaker.recordSuccess(currentModel, duration);
        }

        // ★ Kernel: Record LLM call event, cost, and metrics
        if (processId) {
          this.emitJournalRecord(processId, "LLM_CALL", {
            model: currentModel,
            tokens: result.tokensUsed,
            latencyMs: duration,
          });
        }
        if (processId) {
          // ★ R2-#36 ATTRIBUTION (additive): populate moduleType/referenceId/agentId
          // from BillingContext and MissionContext when available.
          // Falls back to "ai-engine" to preserve existing behaviour for callers
          // that don't wrap in a BillingContext (e.g. direct Ask/Social calls).
          const billingCtx = BillingContext.get();
          const kernelCtx = MissionContext.get();
          this.emitCostRecord({
            userId: userId ?? "",
            moduleType: billingCtx?.moduleType ?? "ai-engine",
            operationType:
              billingCtx?.operationType ?? options.operationName ?? "llm_call",
            referenceId: billingCtx?.referenceId ?? kernelCtx?.missionId,
            agentId: kernelCtx?.agentId,
            model: currentModel,
            provider: currentModelConfig?.provider ?? "",
            inputTokens: result.inputTokens ?? 0,
            outputTokens: result.outputTokens ?? result.tokensUsed,
            cacheReadTokens: result.cacheReadTokens ?? 0,
            cacheWriteTokens: result.cacheCreationTokens ?? 0,
            estimatedCost:
              this.costFor(
                currentModel,
                result.inputTokens ?? 0,
                result.outputTokens ?? result.tokensUsed,
                result.cacheReadTokens ?? 0,
                result.cacheCreationTokens ?? 0,
              ) ?? 0,
          });
        }
        this.emitMetrics({
          model: currentModel,
          provider: currentModelConfig?.provider ?? "",
          modelType: modelType ?? "CHAT",
          module: "ai-engine",
          operation: "chat",
          userId,
          inputTokens: result.inputTokens ?? 0,
          outputTokens: result.outputTokens ?? result.tokensUsed,
          totalTokens: result.tokensUsed,
          latencyMs: duration,
          estimatedCost:
            this.costFor(
              currentModel,
              result.inputTokens ?? 0,
              result.outputTokens ?? result.tokensUsed,
              result.cacheReadTokens ?? 0,
              result.cacheCreationTokens ?? 0,
            ) ?? 0,
          success: true,
          fallbackUsed: attempt > 0,
          retryCount: attempt,
        });

        // ★ Session Latency Tracker: 自动记录 LLM 调用到活跃会话
        this.recordToLatencySession(
          currentModel,
          currentModelConfig?.provider ?? "",
          duration,
          result.tokensUsed,
          false,
          undefined,
          undefined,
          undefined,
          options.operationName,
        );

        // ★ Guardrails: Output validation (skip for internal system calls)
        if (!skipGuardrails) {
          const outputGuardrailResult = await this.runOutputGuardrails(
            result.content,
            result.model,
            {
              spanId,
              tokensUsed: result.tokensUsed,
              pathName: "Standard",
            },
          );
          if (!outputGuardrailResult.passed) {
            return {
              content: "Response filtered by content safety guardrail",
              usage: { totalTokens: result.tokensUsed },
              model: result.model,
              isError: true,
            };
          }
          // ★ PII 脱敏：输出含 PII 时用脱敏后的内容替换再返回用户。
          if (outputGuardrailResult.redactedContent) {
            result.content = outputGuardrailResult.redactedContent;
          }
        }

        if (attempt > 0) {
          this.logger.log(
            `[chat] Fallback successful: ${currentModel} (after ${attempt} failed attempts)`,
          );
        }

        // ★ Observability: End trace span on success
        if (spanId) {
          this.emitSpanEnd(spanId, {
            status: "success",
            output: {
              model: result.model,
              tokensUsed: result.tokensUsed,
              apiKeySource: result.apiKeySource,
              attemptCount: attempt + 1,
            },
          });
        }

        return {
          content: result.content,
          usage: {
            totalTokens: result.tokensUsed,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            cacheCreationTokens: result.cacheCreationTokens,
            cacheReadTokens: result.cacheReadTokens,
          },
          model: result.model,
          finishReason: result.finishReason,
          reasoning: result.reasoning,
          isError: false,
          apiKeySource: result.apiKeySource,
          toolCalls: result.toolCalls,
        };
      }

      lastError = result.content;
      this.logger.warn(
        `[chat] Model ${currentModel} failed: ${result.content.slice(0, 100)}...`,
      );

      // ★ Circuit Breaker: Record failure (prefer preserved errorType over string parsing)
      if (this.circuitBreaker) {
        const errorType = result.errorType
          ? this.mapAIErrorTypeToTaskCompletion(result.errorType)
          : this.circuitBreaker.parseErrorType(result.content);
        this.circuitBreaker.recordFailure(
          currentModel,
          errorType,
          result.content,
        );
      }

      // ★ Kernel: Record LLM error event and metrics
      if (processId) {
        this.emitJournalRecord(processId, "LLM_ERROR", {
          model: currentModel,
          error: result.content.substring(0, 200),
        });
      }
      this.emitMetrics({
        model: currentModel,
        provider: currentModelConfig?.provider ?? "",
        modelType: modelType ?? "CHAT",
        module: "ai-engine",
        operation: "chat",
        userId,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        latencyMs: duration,
        estimatedCost: 0,
        success: false,
        error: result.content.substring(0, 200),
        fallbackUsed: attempt > 0,
        retryCount: attempt,
      });

      // 获取其他可用的同类型模型
      // ★ 2026-05-21 Capability Contract：fallback 池也必须用 effectiveModelType，
      //   否则 quality-first 下主模型失败后会从 CHAT_FAST 池补 mini 模型，重现 bug。
      if (modelType) {
        const effectiveModelType = resolveEffectiveModelType(
          modelType,
          downgradePolicy,
        );
        const alternativeModels =
          await this.modelConfigService.getAllEnabledModelsByType(
            effectiveModelType,
            triedModelIds,
          );

        // ★ BYOK v2：按用户可用 provider 过滤。避免 fallback 到用户没配 Key
        // 的 provider（例如只配 OpenAI 的用户被 fallback 到 Claude 而立即失败）。
        // 管理员 / 无 userId 的系统路径不过滤。
        const effectiveUserId = userId ?? RequestContext.getUserId();
        let providerFilteredModels = alternativeModels;
        if (effectiveUserId && this.keyResolver && !isDirectBYOKPath) {
          try {
            const availableProviders =
              await this.keyResolver.getAvailableProviders(effectiveUserId);
            const allowed = new Set(
              availableProviders.map((p) => p.toLowerCase()),
            );
            if (allowed.size > 0) {
              providerFilteredModels = alternativeModels.filter((c) =>
                allowed.has(c.provider.toLowerCase()),
              );
              if (providerFilteredModels.length < alternativeModels.length) {
                this.logger.debug(
                  `[chat] Filtered ${alternativeModels.length - providerFilteredModels.length} model(s) not in user availableProviders=${[...allowed].join(",")}`,
                );
              }
            }
          } catch (error) {
            this.logger.warn(
              `[chat] getAvailableProviders failed (non-fatal, fallback to unfiltered): ${(error as Error).message}`,
            );
          }
        }

        // ★ Circuit Breaker: Filter out models with OPEN circuit breakers
        const availableModels = this.circuitBreaker
          ? providerFilteredModels.filter((config) =>
              this.circuitBreaker!.canExecute(config.modelId),
            )
          : providerFilteredModels;

        if (availableModels.length < providerFilteredModels.length) {
          this.logger.debug(
            `[chat] CircuitBreaker filtered out ${providerFilteredModels.length - availableModels.length} model(s) with OPEN circuits`,
          );
        }

        if (availableModels.length > 0) {
          currentModelConfig = availableModels[0];
          currentModel = currentModelConfig.modelId;
          this.logger.log(
            `[chat] Falling back to alternative model: ${currentModel} (${currentModelConfig.provider})`,
          );
          continue;
        }
      }

      this.logger.warn(
        `[chat] No more alternative models available. Tried: ${triedModelIds.join(", ")}`,
      );
      break;
    }

    this.logger.error(
      `[chat] All ${triedModelIds.length} models failed. Last error: ${lastError?.slice(0, 100)}`,
    );

    // ★ Observability: End trace span on all models failed
    if (spanId) {
      this.emitSpanEnd(spanId, {
        status: "error",
        error: `All ${triedModelIds.length} models failed: ${lastError?.slice(0, 200)}`,
        output: { triedModels: triedModelIds },
      });
    }

    return {
      content: lastError || "所有可用模型均调用失败，请检查 API 配置",
      usage: { totalTokens: 0 },
      model: currentModel,
      isError: true,
    };
  }

  // ==================== 流式输出 ====================

  /**
   * ★ 流式聊天
   * 支持真正的 SSE 流式响应
   */
  async *chatStream(options: {
    messages: ChatMessage[];
    model?: string;
    modelType?: AIModelType;
    taskProfile?: TaskProfile;
    systemPrompt?: string;
    maxTokens?: number;
    temperature?: number;
    userId?: string;
    /** Skip input/output guardrails for internal system calls */
    skipGuardrails?: boolean;
    /** 操作名称 — 用于时延跟踪标识 step */
    operationName?: string;
  }): AsyncGenerator<
    {
      content: string;
      done: boolean;
      error?: string;
      apiKeySource?: "personal" | "assigned" | "system";
      usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
      };
    },
    void
  > {
    const {
      messages,
      systemPrompt,
      model: inputModel,
      modelType,
      taskProfile,
    } = options;

    // 解析模型
    let model = inputModel;
    if (!model && modelType) {
      // ★ 2026-05-21 Capability Contract：chatStream 与 chat() 一致，过策略闸，
      //   避免流式路径绕过 downgradePolicy（quality-first 下 CHAT_FAST→CHAT）。
      const downgradePolicy = normalizeDowngradePolicy(
        this.configService.get<string>("MODEL_DOWNGRADE_POLICY", ""),
      );
      const effectiveModelType = resolveEffectiveModelType(
        modelType,
        downgradePolicy,
      );
      const modelConfig = await this.getDefaultModelByType(effectiveModelType);
      model = modelConfig?.modelId;
    }
    if (!model) {
      const defaultConfig = await this.getDefaultModelConfig();
      model = defaultConfig?.modelId || "";
    }

    // 获取模型配置
    const modelConfig = await this.getModelConfig(model);
    if (!modelConfig) {
      yield {
        content: `模型 ${model} 未在数据库中配置`,
        done: true,
        error: "MODEL_NOT_CONFIGURED",
      };
      return;
    }

    // ★ BYOK: 使用优先级解析 API Key
    const resolved = await this.modelConfigService.resolveApiKey(
      modelConfig,
      options.userId,
    );
    const apiKey = resolved?.apiKey || null;
    const streamApiKeySource = resolved?.source;
    const effectiveStreamEndpoint =
      resolved?.apiEndpoint || modelConfig.apiEndpoint;
    if (!apiKey) {
      yield {
        content: `模型 ${model} 的 API Key 未配置（直接输入或 Secret Manager 均未找到）`,
        done: true,
        error: "API_KEY_NOT_CONFIGURED",
      };
      return;
    }

    // 应用 taskProfile
    let effectiveMaxTokens = options.maxTokens;
    let effectiveTemperature = options.temperature;

    if (taskProfile) {
      const mapped = this.taskProfileMapper.mapToParameters(
        taskProfile,
        modelConfig,
      );
      effectiveMaxTokens = effectiveMaxTokens ?? mapped.maxTokens;
      effectiveTemperature = effectiveTemperature ?? mapped.temperature;
    }

    effectiveMaxTokens = effectiveMaxTokens || 4000;
    effectiveTemperature = effectiveTemperature ?? 0.7;

    // 构建消息
    const fullMessages: ChatMessage[] = [];
    if (systemPrompt) {
      fullMessages.push({ role: "system", content: systemPrompt });
    }
    fullMessages.push(...messages);

    // v3.1 §D.2.3：显式 fallback —— 优先 DB `apiFormat`，缺失才走 provider 启发式。
    // B+ apiFormat backfill 后,系统模型 DB 已经存 apiFormat 真值; BYOK 个人模型
    // 仍可能 undefined,此时落到启发式（与重构前行为一致）。
    const dbApiFormat = modelConfig.apiFormat;
    const apiFormat: "openai" | "anthropic" | "google" | "xai" =
      dbApiFormat === "openai" ||
      dbApiFormat === "anthropic" ||
      dbApiFormat === "google" ||
      dbApiFormat === "xai"
        ? dbApiFormat
        : this.getApiFormatForProvider(modelConfig.provider);

    // ★ Circuit Breaker: Track load for streaming calls
    if (this.circuitBreaker) {
      this.circuitBreaker.incrementLoad(model);
    }
    const streamStartTime = Date.now();

    // ★ 累积流式输出内容（用于 Guardrails 和 token 估算）
    let accumulatedContent = "";
    let streamUsage:
      | { promptTokens: number; completionTokens: number; totalTokens: number }
      | undefined;
    // ★ 流式时延指标
    let streamTiming:
      | { ttftMs: number; ttltMs: number; streamStartTime: number }
      | undefined;

    // ★ 2026-05-22：流式路径不走 keyExecutor.execute()，手动占用 per-(user+provider)
    //   并发槽，与非流式共用同一桶，防止流式调用绕过节流自我 429。
    const slotRelease = this.failoverCaller
      ? await this.failoverCaller.acquireProviderSlot(
          options.userId ?? "",
          modelConfig.provider,
        )
      : null;
    try {
      // 根据 apiFormat 选择流式处理器
      let streamGenerator: AsyncGenerator<
        {
          content: string;
          done: boolean;
          error?: string;
          usage?: {
            promptTokens: number;
            completionTokens: number;
            totalTokens: number;
          };
          timing?: {
            ttftMs: number;
            ttltMs: number;
            streamStartTime: number;
          };
        },
        void
      >;

      if (apiFormat === "openai") {
        // ★ 约束：DB 显式设了 isReasoning 就用 DB；没设（用户配置时漏标）则按
        //   modelId 启发式兜底。否则 reasoning 模型（gpt-5.x/o1/o3/o4 等）流式会被
        //   发 max_tokens 而非 max_completion_tokens，OpenAI 直接 INVALID_REQUEST。
        const isReasoning =
          modelConfig.isReasoning || inferIsReasoning(modelConfig.modelId);
        const tokenParamName =
          modelConfig.tokenParamName ||
          (isReasoning ? "max_completion_tokens" : "max_tokens");
        streamGenerator = this.streamHandlerService.streamOpenAICompatible(
          effectiveStreamEndpoint,
          apiKey,
          modelConfig.modelId,
          fullMessages,
          effectiveMaxTokens,
          effectiveTemperature,
          tokenParamName,
          isReasoning,
          taskProfile?.reasoningDepth,
        );
      } else if (apiFormat === "anthropic") {
        streamGenerator = this.streamHandlerService.streamAnthropic(
          effectiveStreamEndpoint,
          apiKey,
          modelConfig.modelId,
          fullMessages,
          effectiveMaxTokens,
          effectiveTemperature,
        );
      } else {
        // 不支持流式的 provider，回退到非流式
        const result = await this.chat({
          messages,
          model,
          taskProfile,
          systemPrompt,
          maxTokens: effectiveMaxTokens,
          temperature: effectiveTemperature,
          userId: options.userId,
        });
        yield {
          content: result.content,
          done: true,
          apiKeySource: result.apiKeySource,
        };
        return;
      }

      // ★ 遍历流式 chunks，累积内容
      for await (const chunk of streamGenerator) {
        if (chunk.error) {
          yield chunk;
          return;
        }

        // 累积内容
        if (chunk.content) {
          accumulatedContent += chunk.content;
        }

        // 提取 usage 信息
        if (chunk.usage) {
          streamUsage = chunk.usage;
        }

        // ★ 提取流式时延指标
        if (chunk.timing) {
          streamTiming = chunk.timing;
        }

        // 如果不是最后一个 chunk，直接 yield
        if (!chunk.done) {
          yield chunk;
        }
      }

      // ★ Guardrails: Output validation (skip for internal system calls)
      if (
        !options.skipGuardrails &&
        this.guardrailsEnabled() &&
        accumulatedContent
      ) {
        const pipeline = this.guardrailsPipeline;
        try {
          if (!pipeline) {
            throw new Error("guardrails pipeline unavailable");
          }
          const outputResult = await pipeline.processOutput({
            content: accumulatedContent,
            modelId: model,
          });
          if (!outputResult.passed) {
            this.logger.warn(
              `[chatStream] Output blocked by guardrail: ${outputResult.blockedBy}`,
            );

            // Note: guardrails block is NOT a model failure — do not record in Circuit Breaker

            yield {
              content: "",
              done: true,
              error: `内容违反安全策略: ${outputResult.blockedBy}`,
            };
            return;
          }
        } catch (guardrailsError) {
          const errMsg =
            guardrailsError instanceof Error
              ? guardrailsError.message
              : String(guardrailsError);
          this.logger.error(
            `[chatStream] Guardrails processing error: ${errMsg}`,
          );
          // ★ Security (P0): block 级护栏 fail-closed —— 安全管道异常时阻断输出而非放行。
          yield {
            content: "",
            done: true,
            error: "内容违反安全策略: guardrail-output-error",
          };
          return;
        }
      }

      // ★ Circuit Breaker: Record success after stream completes
      const streamDuration = Date.now() - streamStartTime;
      if (this.circuitBreaker) {
        this.circuitBreaker.recordSuccess(model, streamDuration);
      }

      // ★ Kernel Metrics: Record stream TTFT/TTLT
      this.emitMetrics({
        model,
        provider: modelConfig.provider ?? "",
        modelType: modelType ?? "CHAT",
        module: "ai-engine",
        operation: "chatStream",
        userId: options.userId,
        inputTokens: streamUsage?.promptTokens ?? 0,
        outputTokens: streamUsage?.completionTokens ?? 0,
        totalTokens: streamUsage?.totalTokens ?? 0,
        latencyMs: streamDuration,
        ttftMs: streamTiming?.ttftMs,
        ttltMs: streamTiming?.ttltMs,
        estimatedCost:
          this.costFor(
            model,
            streamUsage?.promptTokens ?? 0,
            streamUsage?.completionTokens ?? 0,
          ) ?? 0,
        success: true,
        fallbackUsed: false,
        retryCount: 0,
      });

      // ★ Session Latency Tracker: 自动记录流式 LLM 调用到活跃会话
      this.recordToLatencySession(
        model,
        modelConfig.provider ?? "",
        streamDuration,
        streamUsage?.totalTokens ?? 0,
        true,
        streamTiming?.ttftMs,
        streamUsage?.promptTokens,
        streamUsage?.completionTokens,
        options.operationName,
      );

      // ★ 流式完成后，发出一个带 apiKeySource 和 usage 的终止信号
      yield {
        content: "",
        done: true,
        apiKeySource: streamApiKeySource,
        usage: streamUsage,
      };

      // PR-4b (2026-05-05) BYOK：流完成 → markSuccess + setLastGood 粘性
      if (resolved?.healthKeyId && this.failoverCaller && options.userId) {
        await this.failoverCaller
          .trackSuccess(
            resolved.healthKeyId,
            modelConfig.provider,
            options.userId,
          )
          .catch((err: unknown) =>
            this.logger.debug(
              `[chatStream] trackSuccess failed: ${err instanceof Error ? err.message : err}`,
            ),
          );
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`[chatStream] Stream error: ${errorMsg}`);

      // ★ Circuit Breaker: Record failure on stream error
      if (this.circuitBreaker) {
        const errorType = this.circuitBreaker.parseErrorType(errorMsg);
        this.circuitBreaker.recordFailure(model, errorType, errorMsg);
      }

      // PR-4b (2026-05-05) BYOK：流失败 → classify + markFailure（401/403/quota=DEAD / 429=COOLDOWN）
      if (resolved?.healthKeyId && this.failoverCaller) {
        await this.failoverCaller
          .trackFailure(resolved.healthKeyId, modelConfig.provider, error)
          .catch((err: unknown) =>
            this.logger.debug(
              `[chatStream] trackFailure failed: ${err instanceof Error ? err.message : err}`,
            ),
          );
      }

      yield { content: "", done: true, error: errorMsg };
    } finally {
      // ★ 释放 per-(user+provider) 并发槽（幂等）
      slotRelease?.();
      // ★ Circuit Breaker: Always release load when stream ends
      if (this.circuitBreaker) {
        this.circuitBreaker.decrementLoad(model);
      }
    }
  }

  // ==================== Guardrails 私有方法 ====================

  /**
   * Guardrails 是否启用。
   *
   * ★ Security (P0): 之前是「全局布尔一键关」——任何环境设 GUARDRAILS_ENABLED=false
   * 即可整体绕过安全护栏。现收敛为：仅当 NODE_ENV !== "production" 时才允许显式关闭，
   * 生产环境恒开，杜绝误配 / 攻击者篡改环境变量关闭护栏。
   */
  private guardrailsEnabled(): boolean {
    if (!this.guardrailsPipeline) {
      return false;
    }
    const disabled =
      this.configService.get<string>("GUARDRAILS_ENABLED") === "false";
    if (!disabled) {
      return true;
    }
    // 显式请求关闭：仅非生产环境允许
    const nodeEnv = this.configService.get<string>("NODE_ENV");
    return nodeEnv === "production";
  }

  /**
   * 运行输入 Guardrails 检查
   * 从 Path A 和 Path B 提取的通用逻辑
   *
   * @param messages - 聊天消息列表
   * @param context - 上下文信息（可选，用于日志和追踪）
   * @returns Guardrail 检查结果，如果通过则返回 null
   */
  private async runInputGuardrails(
    messages: ChatMessage[],
    context?: {
      modelType?: AIModelType;
      model?: string;
      provider?: string;
      modelId?: string;
      spanId?: string;
      pathName?: string; // 'BYOK' or 'Standard'
      /** 见 ChatOptions.trustedInternal —— 透传给 GuardrailInput */
      trustedInternal?: boolean;
    },
  ): Promise<{
    passed: boolean;
    blockedBy?: string;
    // ★ PII 脱敏后的 messages（仅管道改写时返回）：调用方须替换原 messages 再发 provider。
    redactedMessages?: ChatMessage[];
  }> {
    if (!this.guardrailsEnabled()) {
      return { passed: true };
    }

    const userContent = messages
      .filter((m) => m.role === "user")
      .map((m) => m.content)
      .join("\n");

    // guardrailsEnabled() 已确保 pipeline 非空（null 时返回 false 走上面 early-return）
    const pipeline = this.guardrailsPipeline;
    if (!pipeline) {
      return { passed: true };
    }

    try {
      const inputResult = await pipeline.processInput({
        content: userContent,
        trustedInternal: context?.trustedInternal,
        context: {
          modelType: context?.modelType,
          model: context?.model,
          provider: context?.provider,
          modelId: context?.modelId,
        },
      });

      if (!inputResult.passed) {
        const pathLabel = context?.pathName ?? "chat";
        this.logger.warn(
          `[${pathLabel}] Input blocked by guardrail: ${inputResult.blockedBy}`,
        );

        // ★ Observability: End trace span on guardrail block
        if (context?.spanId) {
          this.emitSpanEnd(context.spanId, {
            status: "error",
            error: `Blocked by guardrail: ${inputResult.blockedBy}`,
          });
        }

        return {
          passed: false,
          blockedBy: inputResult.blockedBy,
        };
      }

      // ★ PII 脱敏真生效：管道报告内容被改写时，逐条脱敏 user message 后供调用方替换发 provider。
      if (typeof inputResult.transformedContent === "string") {
        this.logger.warn(
          `[${context?.pathName ?? "chat"}] PII redacted in input before sending to provider`,
        );
        return { passed: true, redactedMessages: redactUserMessages(messages) };
      }

      return { passed: true };
    } catch (error) {
      const pathLabel = context?.pathName ?? "chat";
      this.logger.error(
        `[${pathLabel}] Guardrail input check failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      // ★ Security (P0): block 级护栏 fail-closed —— 安全管道本身抛错时无法判定输入是否安全，
      // 视为不通过/阻断而非放行（旧 fail-open 会让护栏故障即整体绕过）。
      return { passed: false, blockedBy: "guardrail-input-error" };
    }
  }

  /**
   * 运行输出 Guardrails 检查
   * 从 Path A 和 Path B 提取的通用逻辑
   *
   * @param content - AI 生成的内容
   * @param modelId - 使用的模型 ID
   * @param context - 上下文信息（可选，用于日志和追踪）
   * @returns Guardrail 检查结果，如果通过则返回 null
   */
  private async runOutputGuardrails(
    content: string,
    modelId: string,
    context?: {
      spanId?: string;
      tokensUsed?: number;
      pathName?: string; // 'BYOK' or 'Standard'
    },
  ): Promise<{
    passed: boolean;
    blockedBy?: string;
    // ★ PII 脱敏后的输出内容（仅被改写时返回）：调用方须替换返回给用户的内容。
    redactedContent?: string;
  }> {
    if (!this.guardrailsEnabled()) {
      return { passed: true };
    }

    // guardrailsEnabled() 已确保 pipeline 非空（null 时返回 false 走上面 early-return）
    const pipeline = this.guardrailsPipeline;
    if (!pipeline) {
      return { passed: true };
    }

    try {
      const outputResult = await pipeline.processOutput({
        content,
        modelId,
      });

      if (!outputResult.passed) {
        const pathLabel = context?.pathName ?? "chat";
        this.logger.warn(
          `[${pathLabel}] Output blocked by guardrail: ${outputResult.blockedBy}`,
        );

        // ★ Observability: End trace span on guardrail block
        if (context?.spanId) {
          this.emitSpanEnd(context.spanId, {
            status: "error",
            error: `Output blocked by guardrail: ${outputResult.blockedBy}`,
            output: {
              model: modelId,
              tokensUsed: context?.tokensUsed,
            },
          });
        }

        return {
          passed: false,
          blockedBy: outputResult.blockedBy,
        };
      }

      // ★ 输出侧 PII 脱敏：管道未配置输出脱敏 guardrail 时兜底脱敏，保证返回用户的内容不含 PII。
      const redacted = resolveRedactedOutput(
        content,
        outputResult.transformedContent,
      );
      if (redacted !== content) {
        this.logger.warn(
          `[${context?.pathName ?? "chat"}] PII redacted in output before returning to user`,
        );
        return { passed: true, redactedContent: redacted };
      }

      return { passed: true };
    } catch (error) {
      const pathLabel = context?.pathName ?? "chat";
      this.logger.error(
        `[${pathLabel}] Guardrail output check failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      // ★ Security (P0): block 级护栏 fail-closed —— 安全管道本身抛错时无法判定输出是否安全，
      // 视为不通过/阻断而非放行（旧 fail-open 会让护栏故障即整体绕过）。
      return { passed: false, blockedBy: "guardrail-output-error" };
    }
  }
}
