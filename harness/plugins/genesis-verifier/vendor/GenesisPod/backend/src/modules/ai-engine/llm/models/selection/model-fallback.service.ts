/**
 * Model Fallback Service
 *
 * 通用的模型降级和容错服务，提供：
 * - 模型优先级管理
 * - 智能降级链构建
 * - 带重试和模型切换的执行器
 * - 区分可重试错误和需要切换模型的错误
 *
 * 设计原则：
 * 1. 可重试错误（timeout、network）：在同一模型上重试
 * 2. 需要切换模型的错误（quota、api_key、model_invalid）：直接切换到下一个模型
 * 3. 限速错误：首次重试，连续触发则切换模型
 *
 * ★ P4 沉淀：从 AI Teams LeaderModelService 提取的通用能力
 */

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { RequestContext } from "@/common/context/request-context";
import { AIModelConfig } from "../../index";
// 2026-06-10 P0：tokenParamName 决策点的 isReasoning 启发式兜底（DB 未标 reasoning
// 模型时，避免对 gpt-5.x/o1/o3/o4 等发 max_tokens → OpenAI INVALID_REQUEST 全失败）。
import { inferIsReasoning } from "../../types/model.utils";
import {
  AIError,
  AIErrorClassifier,
  AIErrorType,
} from "@/modules/ai-engine/llm/abstractions/error-classifier";
import {
  BYOKError,
  NoModelConfiguredError,
} from "@/modules/platform/credentials/resolution/key-resolver/key-resolver.errors";
import { AIModelType } from "@prisma/client";

// ==================== 类型定义 ====================

/**
 * 模型执行结果
 */
export interface ModelFallbackResult<T> {
  success: boolean;
  data?: T;
  error?: AIError;
  modelUsed: string;
  fallbackUsed: boolean;
  attempts: number;
  attemptedModels: string[];
}

/**
 * 模型执行选项
 */
export interface ModelFallbackOptions {
  /** 最大重试次数（同一模型） */
  maxRetries?: number;
  /** 最大模型切换次数 */
  maxModelSwitches?: number;
  /** 操作描述（用于日志） */
  operation?: string;
  /** 模型类型过滤 */
  modelType?: AIModelType;
  /** 是否优先使用推理模型 */
  preferReasoning?: boolean;
  /** 上下文信息 */
  context?: {
    missionId?: string;
    taskId?: string;
    [key: string]: unknown;
  };
}

/**
 * 模型优先级配置
 */
export interface ModelPriorityConfig {
  /** 优先级模式列表（按顺序匹配） */
  patterns: RegExp[];
  /** 模型类型 */
  modelType: AIModelType;
}

// ==================== 常量定义 ====================

/**
 * 需要直接切换模型的错误类型（不重试）
 */
const MODEL_SWITCH_ERROR_TYPES = new Set<AIErrorType>([
  AIErrorType.QUOTA_EXCEEDED, // 配额耗尽
  AIErrorType.INVALID_API_KEY, // API Key 无效
  AIErrorType.INVALID_MODEL, // 模型不存在
  AIErrorType.CONTENT_FILTERED, // 内容被过滤（换模型可能有不同策略）
]);

/**
 * 不可恢复的错误类型 - 模型需要加入黑名单（带 TTL）
 * 这些错误不会因为重试而自愈，需要人工干预（如更换 API Key、升级 tier）
 *
 * INVALID_MODEL：即使 modelId 存在于 /v1/models 列表，用户 Key tier 不够时 chat
 * 也会返回 "Model not found"（OpenAI free tier 就是这个行为）。加黑名单避免
 * Topic Insights/Writing 等循环任务疯狂 retry 烧用户配额。
 */
const UNRECOVERABLE_ERROR_TYPES = new Set<AIErrorType>([
  AIErrorType.INVALID_API_KEY,
  AIErrorType.INVALID_MODEL,
]);

/** 不可恢复错误的黑名单持续时间（10 分钟） */
const UNRECOVERABLE_BLOCK_DURATION_MS = 10 * 60 * 1000;

/** 配额/限速错误的黑名单持续时间（5 分钟） */
const QUOTA_BLOCK_DURATION_MS = 5 * 60 * 1000;

/**
 * 可重试的错误类型
 */
const RETRYABLE_ERROR_TYPES = new Set<AIErrorType>([
  AIErrorType.TIMEOUT,
  AIErrorType.NETWORK_ERROR,
  AIErrorType.TEMPORARY_UNAVAILABLE,
]);

/**
 * 默认推理模型优先级模式
 */
const DEFAULT_REASONING_MODEL_PRIORITY: RegExp[] = [
  // Tier 1: 显式推理模型
  /^o3/i, // OpenAI O3
  /^o1/i, // OpenAI O1
  /^gpt-5/i, // GPT-5
  /deepseek.*r1/i, // DeepSeek R1
  /deepseek-reasoner/i,
  /claude.*opus/i, // Claude Opus
  // Tier 2: 强推理能力模型
  /gpt-4o(?!-mini)/i, // GPT-4o (not mini)
  /gpt-4(?!o)/i, // GPT-4 (not 4o)
  /claude.*sonnet/i, // Claude Sonnet
  /gemini.*pro/i, // Gemini Pro
  /grok-2/i, // Grok 2
  // Tier 3: 标准模型
  /grok/i,
  /gemini/i,
  /claude/i,
];

/**
 * 默认快速模型优先级模式
 */
const DEFAULT_FAST_MODEL_PRIORITY: RegExp[] = [
  /gpt-4o-mini/i,
  /gpt-3\.5/i,
  /claude.*haiku/i,
  /gemini.*flash/i,
  /deepseek.*chat/i,
];

// ==================== 服务实现 ====================

@Injectable()
export class ModelFallbackService {
  private readonly logger = new Logger(ModelFallbackService.name);
  private readonly errorClassifier = new AIErrorClassifier();

  /** 模型优先级配置（可通过 setModelPriority 自定义） */
  private reasoningPriorityPatterns = DEFAULT_REASONING_MODEL_PRIORITY;
  private fastPriorityPatterns = DEFAULT_FAST_MODEL_PRIORITY;

  /** 模型黑名单：modelId → 解除时间戳 */
  private readonly modelBlocklist = new Map<
    string,
    { until: number; reason: string }
  >();

  constructor(private readonly prisma: PrismaService) {}

  // ==================== 公共 API ====================

  /**
   * 设置推理模型优先级模式
   */
  setReasoningModelPriority(patterns: RegExp[]): void {
    this.reasoningPriorityPatterns = patterns;
    this.logger.log(
      `[setReasoningModelPriority] Updated with ${patterns.length} patterns`,
    );
  }

  /**
   * 设置快速模型优先级模式
   */
  setFastModelPriority(patterns: RegExp[]): void {
    this.fastPriorityPatterns = patterns;
    this.logger.log(
      `[setFastModelPriority] Updated with ${patterns.length} patterns`,
    );
  }

  /**
   * 获取模型降级链
   * 返回按优先级排序的可用模型列表
   */
  async getModelFallbackChain(
    options: {
      modelType?: AIModelType;
      preferReasoning?: boolean;
      excludeModels?: string[];
    } = {},
  ): Promise<AIModelConfig[]> {
    const {
      modelType = AIModelType.CHAT,
      preferReasoning = false,
      excludeModels = [],
    } = options;

    try {
      // ★ BYOK: 若当前请求有 userId 且用户已配 UserModelConfig，
      // fallback 链从用户自己的模型里构建——不要偷偷跳到 admin AIModel，
      // 否则 ModelFallbackService 会把用户的 gpt-4o-2024-11-20 失败后
      // fallback 到 admin 的 gpt-5.4，烧 admin 的 key。
      const userId = RequestContext.getUserId();
      type FallbackModel = Parameters<
        ModelFallbackService["toAIModelConfig"]
      >[0];
      let allModels: FallbackModel[];

      if (userId) {
        const userRows = await this.prisma.userModelConfig.findMany({
          where: {
            userId,
            modelType,
            isEnabled: true,
            modelId: { notIn: excludeModels },
          },
          orderBy: [{ isDefault: "desc" }, { priority: "desc" }],
        });
        if (userRows.length > 0) {
          allModels = userRows.map(
            // ★ 2026-05-01 (mission 9a3144fc 真因)：补齐 BYOK 全量字段透传 ——
            //   之前只透 12 个字段，apiFormat / tokenParamName / supports_* 全丢，
            //   下游 ai-chat 默认 apiFormat='openai' 把 xai 模型路由到 OpenAI 端，
            //   触发 xAI "requested resource was not found" 404。
            (r): FallbackModel => ({
              id: r.id,
              name: r.modelId,
              displayName: r.displayName,
              provider: r.provider,
              modelId: r.modelId,
              apiEndpoint: r.apiEndpoint ?? "",
              apiKey: null,
              maxTokens: r.maxTokens,
              temperature: r.temperature,
              isEnabled: r.isEnabled,
              isDefault: r.isDefault,
              isReasoning: r.isReasoning,
              apiFormat: r.apiFormat,
              tokenParamName: r.tokenParamName,
              supportsTemperature: r.supportsTemperature,
              supportsStreaming: r.supportsStreaming,
              supportsFunctionCalling: r.supportsFunctionCalling,
              supportsVision: r.supportsVision,
              defaultTimeoutMs: r.defaultTimeoutMs,
              priceInputPerMillion: r.priceInputPerMillion,
              priceOutputPerMillion: r.priceOutputPerMillion,
              priority: r.priority,
            }),
          );
          this.logger.debug(
            `[getModelFallbackChain] Using ${userRows.length} UserModelConfig rows for user=${userId}, type=${modelType}`,
          );
        } else {
          // 普通用户没配：返回空链，让上层抛清晰错误，
          // 不再偷偷 fallback 到 admin AIModel。
          this.logger.warn(
            `[getModelFallbackChain] User ${userId} has no ${modelType} UserModelConfig — returning empty chain (no admin fallback)`,
          );
          return [];
        }
      } else {
        allModels = (await this.prisma.aIModel.findMany({
          where: {
            modelType,
            isEnabled: true,
            modelId: { notIn: excludeModels },
          },
          orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
        })) as unknown as FallbackModel[];
      }

      if (allModels.length === 0) {
        this.logger.warn(
          `[getModelFallbackChain] No ${modelType} models available`,
        );
        return [];
      }

      // 2. 根据优先级排序
      let sortedModels: typeof allModels;

      if (preferReasoning) {
        // 分离显式推理模型和其他模型
        const explicitReasoningModels = allModels.filter((m) => m.isReasoning);
        const otherModels = allModels.filter((m) => !m.isReasoning);

        // 按优先级模式排序其他模型
        const sortedOtherModels = this.sortByPriority(
          otherModels,
          this.reasoningPriorityPatterns,
        );

        // 显式推理模型优先
        sortedModels = [...explicitReasoningModels, ...sortedOtherModels];
      } else {
        // 使用快速模型优先级
        sortedModels = this.sortByPriority(
          allModels,
          this.fastPriorityPatterns,
        );
      }

      // 3. 过滤被阻断的模型
      const unblockedModels = sortedModels.filter((m) => {
        if (this.isModelBlocked(m.modelId)) {
          const entry = this.modelBlocklist.get(m.modelId);
          this.logger.debug(
            `[getModelFallbackChain] Skipping blocked model ${m.modelId} (${entry?.reason})`,
          );
          return false;
        }
        return true;
      });

      // 4. 转换为 AIModelConfig
      const result = unblockedModels.map((m) => this.toAIModelConfig(m));

      this.logger.debug(
        `[getModelFallbackChain] Built fallback chain (${preferReasoning ? "reasoning" : "standard"}): ${result.map((m) => m.modelId).join(" → ")}`,
      );

      return result;
    } catch (error) {
      this.logger.error(
        `[getModelFallbackChain] Failed to get fallback chain: ${error}`,
      );
      return [];
    }
  }

  /**
   * 带重试和模型切换的执行方法
   *
   * @param preferredModelId 首选模型 ID
   * @param executor 执行函数，接收模型配置，返回执行结果
   * @param options 执行选项
   */
  async executeWithFallback<T>(
    preferredModelId: string,
    executor: (modelConfig: AIModelConfig) => Promise<T>,
    options: ModelFallbackOptions = {},
  ): Promise<ModelFallbackResult<T>> {
    const {
      maxRetries = 2,
      maxModelSwitches = 3,
      operation = "model_call",
      modelType = AIModelType.CHAT,
      preferReasoning = false,
      context: _context = {},
    } = options;
    void _context; // 保留用于未来日志增强

    const attemptedModels: string[] = [];
    let totalAttempts = 0;
    let currentModelId = preferredModelId;
    let modelSwitchCount = 0;
    let lastError: AIError | undefined;
    let rateLimitRetryCount = 0;

    // 获取降级链
    const fallbackChain = await this.getModelFallbackChain({
      modelType,
      preferReasoning,
    });

    if (fallbackChain.length === 0) {
      // ★ BYOK: 登录用户没配模型 → 抛 BYOK 错误，前端能识别并给友好引导；
      // 没 userId（admin / system job）走老路径
      if (RequestContext.getUserId()) {
        throw new NoModelConfiguredError(modelType);
      }
      // ★ 全覆盖审计修 (2026-05-06): 细化 admin 路径 fallback-chain 为空的错误类型：
      //   - 无启用模型（DB 配置缺失） → NO_MODEL
      //   - lastError 指向 API key 问题 → NO_API_KEY
      //   - lastError 指向全链路不可用 → API_UNAVAILABLE
      //   注意：错误对象中不含 userId（敏感信息）
      const emptyChainErrorType =
        lastError?.type === AIErrorType.INVALID_API_KEY
          ? AIErrorType.NO_API_KEY
          : lastError?.type === AIErrorType.TEMPORARY_UNAVAILABLE
            ? AIErrorType.API_UNAVAILABLE
            : AIErrorType.NO_MODEL;
      return {
        success: false,
        error: new AIError(
          emptyChainErrorType,
          `No available models for fallback (modelType=${modelType})`,
          undefined,
          undefined,
          undefined,
          // details: 不含 userId，仅包含非敏感的诊断信息
          { modelType, reason: emptyChainErrorType },
        ),
        modelUsed: preferredModelId,
        fallbackUsed: false,
        attempts: 0,
        attemptedModels: [],
      };
    }

    // 主循环：模型切换
    while (modelSwitchCount <= maxModelSwitches) {
      // 获取当前模型配置
      let modelConfig = await this.getModelConfig(currentModelId);

      // 如果首选模型不可用，从降级链中选择
      if (!modelConfig) {
        const availableModel = fallbackChain.find(
          (m) => !attemptedModels.includes(m.modelId),
        );
        if (!availableModel) {
          this.logger.error(
            `[${operation}] No more models available after ${attemptedModels.length} attempts`,
          );
          break;
        }
        modelConfig = availableModel;
        currentModelId = modelConfig.modelId;
        if (preferredModelId) {
          this.logger.warn(
            `[${operation}] Preferred model ${preferredModelId} not available, using ${currentModelId}`,
          );
        } else {
          this.logger.debug(
            `[${operation}] No preferred model specified, using ${currentModelId}`,
          );
        }
      }

      // 内层循环：同一模型的重试
      for (let retry = 0; retry <= maxRetries; retry++) {
        totalAttempts++;

        try {
          this.logger.debug(
            `[${operation}] Attempting with model ${currentModelId} (attempt ${retry + 1}/${maxRetries + 1}, switch ${modelSwitchCount}/${maxModelSwitches})`,
          );

          const result = await executor(modelConfig);

          // 成功
          this.logger.log(
            `[${operation}] Success with model ${currentModelId} after ${totalAttempts} total attempts`,
          );

          return {
            success: true,
            data: result,
            modelUsed: currentModelId,
            // 2026-05-13 #51: 旧逻辑 `currentModelId !== preferredModelId` 在
            // preferredModelId 为空字符串（TaskProfile 自动解析路径）时永远 true
            // → AIFacade 误打 "Model fallback used" warn。真正 fallback 需要
            // preferredModelId 非空且实际 elected 模型不同才算。
            fallbackUsed:
              !!preferredModelId && currentModelId !== preferredModelId,
            attempts: totalAttempts,
            attemptedModels: [...new Set(attemptedModels)],
          };
        } catch (error) {
          // ★ BYOK 错误（用户没 Key / 配额耗尽 / 用户自带 Key 无效）是
          // 用户维度的配置问题，跟模型本身无关。不要归到模型黑名单，
          // 也不要尝试 fallback —— 直接把错误抛回给上层，让 HTTP 层
          // 返回 403 + code，前端 GlobalByokErrorModal 自动弹窗。
          if (error instanceof BYOKError) {
            this.logger.debug(
              `[${operation}] BYOKError (${error.code}) from ${currentModelId}: ` +
                `user-scoped issue, not blocking model, rethrowing to caller`,
            );
            throw error;
          }
          const classifiedError = this.errorClassifier.classify(
            error,
            modelConfig.provider,
          );
          lastError = classifiedError;

          this.logger.warn(
            `[${operation}] Error with model ${currentModelId}: ${classifiedError.type} - ${classifiedError.message}`,
          );

          // 判断是否需要立即切换模型
          if (MODEL_SWITCH_ERROR_TYPES.has(classifiedError.type)) {
            this.logger.log(
              `[${operation}] Error type ${classifiedError.type} requires immediate model switch`,
            );
            // 不可恢复错误（如 API Key 无效）加入黑名单，避免后续请求重复尝试
            if (
              UNRECOVERABLE_ERROR_TYPES.has(classifiedError.type) ||
              classifiedError.type === AIErrorType.QUOTA_EXCEEDED
            ) {
              this.blockModel(currentModelId, classifiedError.type);
            }
            attemptedModels.push(currentModelId);
            break;
          }

          // 限速错误：首次重试，连续则切换
          if (classifiedError.type === AIErrorType.RATE_LIMIT) {
            rateLimitRetryCount++;
            if (rateLimitRetryCount >= 2) {
              this.logger.log(
                `[${operation}] Consecutive rate limits, switching model`,
              );
              attemptedModels.push(currentModelId);
              rateLimitRetryCount = 0;
              break;
            }
            await this.delay(classifiedError.getRetryDelay());
            continue;
          }

          // 可重试错误：等待后重试
          if (RETRYABLE_ERROR_TYPES.has(classifiedError.type)) {
            if (retry < maxRetries) {
              const delay = this.calculateRetryDelay(
                retry,
                classifiedError.getRetryDelay(),
              );
              this.logger.debug(
                `[${operation}] Retrying after ${delay}ms (${classifiedError.type})`,
              );
              await this.delay(delay);
              continue;
            }
          }

          // 其他错误或重试次数用完：切换模型
          if (retry >= maxRetries) {
            this.logger.log(
              `[${operation}] Max retries reached for model ${currentModelId}, switching`,
            );
            attemptedModels.push(currentModelId);
            break;
          }
        }
      }

      // 选择下一个模型
      modelSwitchCount++;
      const nextModel = fallbackChain.find(
        (m) => !attemptedModels.includes(m.modelId),
      );

      if (!nextModel) {
        this.logger.error(`[${operation}] No more models in fallback chain`);
        break;
      }

      currentModelId = nextModel.modelId;
      this.logger.log(
        `[${operation}] Switching to fallback model: ${currentModelId}`,
      );
    }

    // 所有尝试都失败了
    this.logger.error(
      `[${operation}] All attempts failed. Models tried: ${attemptedModels.join(", ")}`,
    );

    return {
      success: false,
      error:
        lastError ||
        new AIError(
          AIErrorType.UNKNOWN,
          "All model attempts failed",
          undefined,
          undefined,
          undefined,
        ),
      modelUsed: currentModelId,
      fallbackUsed: true,
      attempts: totalAttempts,
      attemptedModels,
    };
  }

  /**
   * 获取单个模型配置
   */
  async getModelConfig(modelId: string): Promise<AIModelConfig | null> {
    try {
      // ★ BYOK: 登录用户优先在 UserModelConfig 里查，命中就返回用户的，
      // 不要让 preferredModelId 指到 admin 的 AIModel 后误用 admin secretKey。
      const userId = RequestContext.getUserId();
      if (userId) {
        const userRow = await this.prisma.userModelConfig.findFirst({
          where: {
            userId,
            isEnabled: true,
            OR: [
              { modelId: { equals: modelId, mode: "insensitive" } },
              { displayName: { equals: modelId, mode: "insensitive" } },
            ],
          },
        });
        if (userRow) {
          return {
            id: userRow.id,
            name: userRow.modelId,
            displayName: userRow.displayName,
            provider: userRow.provider,
            modelId: userRow.modelId,
            apiEndpoint: userRow.apiEndpoint ?? "",
            apiKey: null, // resolveApiKey 会用用户 Key
            maxTokens: userRow.maxTokens,
            temperature: userRow.temperature,
            isEnabled: userRow.isEnabled,
            isDefault: userRow.isDefault,
            isReasoning: userRow.isReasoning,
          };
        }
        // 用户有 UserModelConfig 但没匹配这个 modelId → 不 fallback admin
        // （除非用户一条都没配，那就是 admin/系统上下文失效，老路径）
        const userHasAnyConfig = await this.prisma.userModelConfig.count({
          where: { userId, isEnabled: true },
        });
        if (userHasAnyConfig > 0) return null;
      }

      const model = await this.prisma.aIModel.findFirst({
        where: {
          OR: [
            { modelId: { equals: modelId, mode: "insensitive" } },
            { name: { equals: modelId, mode: "insensitive" } },
          ],
          isEnabled: true,
        },
      });

      if (!model) {
        return null;
      }

      return this.toAIModelConfig(model);
    } catch (error) {
      this.logger.error(`[getModelConfig] Failed for ${modelId}: ${error}`);
      return null;
    }
  }

  /**
   * 检查错误是否应该切换模型
   */
  shouldSwitchModel(error: AIError): boolean {
    return (
      MODEL_SWITCH_ERROR_TYPES.has(error.type) ||
      error.type === AIErrorType.RATE_LIMIT
    );
  }

  /**
   * 检查错误是否可重试
   */
  isRetryableError(error: AIError): boolean {
    return RETRYABLE_ERROR_TYPES.has(error.type);
  }

  // ==================== 模型黑名单 ====================

  /**
   * 检查模型是否被阻断
   */
  isModelBlocked(modelId: string): boolean {
    const entry = this.modelBlocklist.get(modelId);
    if (!entry) return false;
    if (Date.now() >= entry.until) {
      this.modelBlocklist.delete(modelId);
      this.logger.log(
        `[modelBlocklist] Model ${modelId} block expired, removed from blocklist`,
      );
      return false;
    }
    return true;
  }

  /**
   * 将模型加入黑名单
   */
  private blockModel(modelId: string, errorType: AIErrorType): void {
    const durationMs = UNRECOVERABLE_ERROR_TYPES.has(errorType)
      ? UNRECOVERABLE_BLOCK_DURATION_MS
      : QUOTA_BLOCK_DURATION_MS;
    const until = Date.now() + durationMs;
    this.modelBlocklist.set(modelId, { until, reason: errorType });
    this.logger.warn(
      `[modelBlocklist] Blocked model ${modelId} for ${durationMs / 1000}s due to ${errorType}`,
    );
  }

  // ==================== 私有方法 ====================

  /**
   * 按优先级模式排序模型
   */
  private sortByPriority<T extends { modelId: string }>(
    models: T[],
    priorityPatterns: RegExp[],
  ): T[] {
    return [...models].sort((a, b) => {
      const priorityA = this.getModelPriority(a.modelId, priorityPatterns);
      const priorityB = this.getModelPriority(b.modelId, priorityPatterns);
      return priorityA - priorityB;
    });
  }

  /**
   * 获取模型优先级（数字越小优先级越高）
   */
  private getModelPriority(modelId: string, patterns: RegExp[]): number {
    for (let i = 0; i < patterns.length; i++) {
      if (patterns[i].test(modelId)) {
        return i;
      }
    }
    return patterns.length;
  }

  /**
   * 转换数据库模型为 AIModelConfig
   *
   * ★ 2026-05-01 (mission 9a3144fc 真因): 之前只透 12 个字段，apiFormat / tokenParamName /
   *   supports_* 全丢，BYOK 路径下 ai-chat 默认 apiFormat='openai' 把 xai 模型错路由到
   *   OpenAI 端，触发 xAI 404。补齐全部 capability + format + pricing 字段。
   */
  private toAIModelConfig(model: {
    id: string;
    name: string;
    displayName: string;
    provider: string;
    modelId: string;
    apiEndpoint: string;
    apiKey: string | null;
    maxTokens: number;
    temperature: number;
    isEnabled: boolean;
    isDefault: boolean;
    isReasoning: boolean;
    apiFormat?: string | null;
    tokenParamName?: string | null;
    supportsTemperature?: boolean | null;
    supportsStreaming?: boolean | null;
    supportsFunctionCalling?: boolean | null;
    supportsVision?: boolean | null;
    defaultTimeoutMs?: number | null;
    priceInputPerMillion?: unknown;
    priceOutputPerMillion?: unknown;
    priority?: number | null;
  }): AIModelConfig {
    // ★ apiFormat 兜底：DB 没设 / 设错（如 xai 模型存了 openai）→ 按 provider 推断
    const inferredFormat = this.inferApiFormatFromProvider(model.provider);
    const apiFormat =
      !model.apiFormat || model.apiFormat === "openai"
        ? inferredFormat
        : model.apiFormat;
    // 2026-06-10 P0：DB 的 isReasoning 列是 NOT NULL @default(false)，故"未标记"
    // 与"显式 false"在此层无法区分。对 reasoning 名模型（gpt-5.x/o1/o3/o4/...）做
    // 启发式 OR 兜底：DB 为 true 直用；DB 为 false 但模型名是 reasoning → 仍判 true，
    // 避免发 max_tokens → OpenAI INVALID_REQUEST 全失败。
    const isReasoning = model.isReasoning || inferIsReasoning(model.modelId);
    return {
      id: model.id,
      name: model.name,
      displayName: model.displayName,
      provider: model.provider,
      modelId: model.modelId,
      apiEndpoint: model.apiEndpoint,
      // 2026-05-12 BYOK 单源：admin 兼容路径透传 AIModel.apiKey 明文列；业务消费方应走
      // KeyResolver.resolveKey(userId, provider)，不要直读此字段。PR-4 双源收尾后删除.
      apiKey: model.apiKey,
      maxTokens: model.maxTokens,
      temperature: model.temperature,
      isEnabled: model.isEnabled,
      isDefault: model.isDefault,
      isReasoning,
      apiFormat,
      tokenParamName:
        model.tokenParamName ??
        (isReasoning ? "max_completion_tokens" : "max_tokens"),
      // ★ reasoning 强制 false（supportsTemperature NOT NULL @default(true)，?? 对漏标
      //   reasoning 失效；reasoning 发 temperature → OpenAI 400）。
      supportsTemperature: isReasoning
        ? false
        : (model.supportsTemperature ?? true),
      supportsStreaming: model.supportsStreaming ?? true,
      supportsFunctionCalling: model.supportsFunctionCalling ?? true,
      supportsVision: model.supportsVision ?? false,
      defaultTimeoutMs:
        model.defaultTimeoutMs ?? (isReasoning ? 300000 : 120000),
      priceInputPerMillion:
        model.priceInputPerMillion != null
          ? Number(model.priceInputPerMillion)
          : undefined,
      priceOutputPerMillion:
        model.priceOutputPerMillion != null
          ? Number(model.priceOutputPerMillion)
          : undefined,
      priority: model.priority ?? 50,
    };
  }

  private inferApiFormatFromProvider(provider: string): string {
    const lower = (provider ?? "").toLowerCase();
    if (lower === "anthropic" || lower === "claude") return "anthropic";
    if (lower === "google" || lower === "gemini") return "google";
    if (lower === "xai" || lower === "grok") return "xai";
    if (lower === "cohere") return "cohere";
    return "openai";
  }

  /**
   * 计算重试延迟（指数退避 + 抖动）
   */
  private calculateRetryDelay(attempt: number, baseDelay: number): number {
    const exponentialDelay = baseDelay * Math.pow(2, attempt);
    const jitter = 0.75 + Math.random() * 0.5; // 0.75 - 1.25
    return Math.min(exponentialDelay * jitter, 30000); // 最大 30 秒
  }

  /**
   * 延迟
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
