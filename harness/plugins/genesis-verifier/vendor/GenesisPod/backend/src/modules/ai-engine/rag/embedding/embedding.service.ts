/**
 * AI Engine - Embedding Service
 * 通用向量嵌入生成服务
 *
 * 提供:
 * - 多 Provider 支持 (OpenAI, Google, Cohere, xAI 等)
 * - 基于 apiFormat 的数据驱动路由
 * - 批量嵌入生成
 * - 动态模型配置
 */

import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  Optional,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SecretsService } from "@/modules/platform/facade";
import { AiApiCallerService } from "@/modules/ai-engine/llm/providers/ai-api-caller.service";
import { KeyResolverService } from "@/modules/platform/credentials/resolution/key-resolver/key-resolver.service";
import { NoAvailableKeyError } from "@/modules/platform/credentials/resolution/key-resolver/key-resolver.errors";
import { KeyErrorClassifier } from "@/modules/platform/credentials/governance/key-health/key-error-classifier";
import { AiModelConfigService } from "@/modules/ai-engine/llm/models/config/ai-model-config.service";
import { RequestContext } from "@/common/context/request-context";
import { OnEvent } from "@nestjs/event-emitter";

// Default fallback values
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_EMBEDDING_DIMENSIONS = 1536;
const MAX_BATCH_SIZE = 100;
// Cohere embed API limits: 96 texts per request
const COHERE_MAX_BATCH_SIZE = 96;

/**
 * EmbeddingTaskType → Cohere input_type 映射
 *   - document → search_document（向量库存储）
 *   - query → search_query（检索查询）
 *   - similarity → classification（语义相似度走 classification embedding 空间）
 *   - classification → classification
 *   - clustering → clustering
 * 见 https://docs.cohere.com/docs/embed-api
 */
function cohereInputType(taskType: string): string {
  switch (taskType) {
    case "query":
      return "search_query";
    case "similarity":
    case "classification":
      return "classification";
    case "clustering":
      return "clustering";
    case "document":
    default:
      return "search_document";
  }
}

/**
 * Embedding 模型配置
 */
export interface EmbeddingModelConfig {
  modelId: string;
  dimensions: number;
  apiKey: string;
  apiEndpoint?: string;
  provider: string;
  apiFormat: string;
  maxInputTokens?: number;
  /**
   * ★ 2026-05-12: BYOK 路径必带——成功/失败后回写 user_api_keys.usage_count /
   *   last_used_at / test_status 用。LLM chat 走 KeyExecutor 自动写，embedding
   *   过去只取 apiKey 丢弃 healthKeyId，导致 BYOK Cohere 在向量化/Rerank 跑了一
   *   堆但 UI 永远 0 hits / "未使用"（用户截图反馈 2026-05-12）。
   *   system 路径无 healthKeyId（cron / 后台任务无 user 上下文）。
   */
  healthKeyId?: string;
}

/**
 * 单个嵌入结果
 */
export interface EmbeddingResult {
  text: string;
  embedding: number[];
  tokenCount: number;
}

/**
 * 批量嵌入结果
 */
export interface EmbeddingBatch {
  texts: string[];
  embeddings: number[][];
  totalTokens: number;
}

/**
 * Embedding 任务类型 —— 影响 provider 端编码空间。
 *
 * Cohere v3 / Google gemini-embedding-001 / Voyage v3 都按 task 区分编码：
 *   - document: 向量库存储用（文档侧）
 *   - query: 检索查询用
 *   - similarity / classification / clustering: 其他场景
 *
 * OpenAI text-embedding-3-* 不区分（同一模型）—— 字段会被忽略，无副作用。
 * 不传 → 默认 "document"（最常见：向量化 KB chunk）。
 */
export type EmbeddingTaskType =
  | "document"
  | "query"
  | "similarity"
  | "classification"
  | "clustering";

/**
 * generateEmbeddings 调用选项
 *
 * ★ 2026-05-12: 加 maxRetries 让带 TPM-aware 外层节流的 caller（如
 *   embedding-processor.service.ts）可关闭内层 3-retry——
 *   否则 1 个外层 batch 在 ~4s 内打 3 个 HTTP 给 Google，
 *   peak burst 直接 429 + quota window 被污染。
 *   外层已有更智能的 60s 等-滚-quota-window 重试。
 *
 * ★ 2026-05-12 (二弹): 加 taskType + dimensions
 *   - taskType: 区分 document / query，Cohere/Google/Voyage 端编码空间不同
 *   - dimensions: Matryoshka 截断，OpenAI 3-* + Gemini 支持
 */
export interface EmbeddingCallOptions {
  /**
   * 内层 429 重试次数（含首次尝试）。
   *   - undefined / 不传：用默认值 3（向后兼容）
   *   - 1：禁用内层重试，全交给外层节流（推荐：外层有 TPM-aware throttle）
   */
  maxRetries?: number;
  /**
   * 任务类型 —— 决定 Cohere input_type / Google task_type / Voyage input_type。
   * 不传 → "document"。OpenAI text-embedding-* 会忽略此字段。
   */
  taskType?: EmbeddingTaskType;
  /**
   * 输出维度 —— OpenAI text-embedding-3-* 支持 (256/512/1024/1536/3072),
   * Google gemini-embedding-001 支持 (768/1536/3072)。
   * 不传 → 用 EmbeddingModelConfig.dimensions（admin 配置）。
   */
  dimensions?: number;
}

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  // 2026-05-11 BYOK 改造：cache 从 single → Map keyed by `userId | "__system__"`，
  //   不同用户用各自 BYOK key，cache 必须按 user 隔离。TTL 60s 自动过期，
  //   并发用户数 ≤ 1k 时 Map 不会无限增长。
  private readonly cachedConfigByUser: Map<
    string,
    { config: EmbeddingModelConfig; time: number }
  > = new Map();
  private readonly CONFIG_CACHE_TTL = 60000; // 1 minute cache
  private static readonly SYSTEM_CACHE_KEY = "__system__";

  // ★ 2026-05-04 加：429 退避 + 熔断器（防止 OpenAI embedding 429 风暴
  //   带垮 RAG 检索 + Figure relevance 筛选）
  //   - 连续 N 次 429 in 时间窗 → 打开熔断 X 秒，期间直接 throw "circuit-open"
  //     不再发请求（让上游 fallback 而不是 retry storm）
  //   - 单次请求遇 429 → 指数退避重试（最多 3 次）
  private rateLimitFailures: number[] = []; // timestamp 数组
  private circuitOpenUntil = 0;
  private static readonly CIRCUIT_THRESHOLD = 5; // 5 次 429 in window → 打开
  private static readonly CIRCUIT_WINDOW_MS = 60_000; // 1 分钟内
  private static readonly CIRCUIT_OPEN_DURATION_MS = 60_000; // 打开后冷却 60s
  private static readonly RETRY_MAX_ATTEMPTS = 3;
  private static readonly RETRY_BASE_DELAY_MS = 1000; // 1s, 2s, 4s 指数退避

  // ★ 2026-05-05 P0 修复：401-aware 熔断器（系统配置失效保护）
  //   线上观察：DB EMBEDDING 模型 secretKey → Secret Manager 失效 OpenAI key
  //   → 单 mission 524 次 401 ERROR 刷屏。401 不应重试（认证失败重试无意义），
  //   也不应每次都 ERROR 刷屏。逻辑：
  //   - 第一次 401 → ERROR + invalidate config cache（让 admin 改了 key 后能立刻生效）
  //   - cooldown 期内（5min）后续 401 → 静默（return cached error / 上游 fallback）
  //   - cooldown 到期 → 重置，给一次机会重试（admin 可能已改 key）
  private static readonly AUTH_FAILURE_COOLDOWN_MS = 5 * 60_000; // 5 分钟（log メッセージ用）

  // ★ 全覆盖审计修 (2026-05-06): 高并发下多 provider/baseUrl 组合的 401 去重
  //   Map key = "${provider}::${baseUrl|''}", value = cooldown 到期时间戳
  //   第一次 401 → ERROR（可见）; cooldown 期内 → DEBUG（不刷屏）
  //   场景：系统同时配置了多个 embedding provider，各自独立 cooldown
  // ★ P5 per-endpoint 熔断 (2026-05-06): 同一 Map 现在也作 per-endpoint 熔断器
  //   改 60s → 5min，与原全局 AUTH_FAILURE_COOLDOWN_MS 对齐，但隔离到每个 endpoint。
  private static readonly AUTH_COOLDOWN_PER_ENDPOINT_MS = 5 * 60_000; // 5 min
  private readonly authErrorEndpoints = new Map<string, number>(); // key → expiry ts

  constructor(
    private readonly secretsService: SecretsService,
    private readonly aiApiCallerService: AiApiCallerService,
    private readonly configService: ConfigService,
    /** 2026-05-12: 严格 BYOK 必需依赖，**不**用 @Optional()。
     *  module imports 配错 → NestFactory 启动直接报错（防 c0eed7c71 类事故）。 */
    private readonly keyResolver: KeyResolverService,
    /** 2026-05-12: 项目唯一 BYOK 选模型入口——所有 AI 入口都走它，不在 service
     *  内重复 BYOK 选择逻辑（embedding/chat/image 等共享同一函数）。 */
    private readonly aiModelConfig: AiModelConfigService,
    /** 2026-05-12: failure 时 classify 出 ClassifiedError 写回
     *  user_api_keys.test_status / last_error_code，与 KeyExecutor / KeyChain 共用同一分类器。 */
    private readonly keyErrorClassifier: KeyErrorClassifier,
    /** v5.1 R0.5-E B-#6 (2026-05-05): EMBEDDING_REQUEST hook seam，可选注入。
     *  plugin 可拦截 / 替换 embedding（缓存 / fallback provider）。 */
    @Optional()
    private readonly hookBus?: import("@/plugins/core/hook-bus").HookBus,
  ) {}

  private isRateLimitError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return /429|rate.?limit|too many requests/i.test(msg);
  }

  /**
   * ★ 2026-05-05 P0 修复：检测 401（认证失败 = key 失效）
   */
  private isAuthError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return /\b401\b|unauthorized|invalid.*api.?key|authentication/i.test(msg);
  }

  // ★ P5 (2026-05-06): 全局 isAuthCircuitOpen 已被 per-endpoint
  //   isEndpointAuthCoolingDown 替代，保留字段避免破坏向后兼容（log 可能引用）。

  // ★ 全覆盖审计修 (2026-05-06): 高并发 401 去重 helpers
  private endpointAuthKey(provider: string, baseUrl?: string): string {
    return `${provider}::${baseUrl ?? ""}`;
  }

  /**
   * 返回 true = 已在 cooldown 内（不应再打 ERROR）
   * 返回 false = 第一次或 cooldown 已过（应打 ERROR + 重设 cooldown）
   */
  private isEndpointAuthCoolingDown(
    provider: string,
    baseUrl?: string,
  ): boolean {
    const key = this.endpointAuthKey(provider, baseUrl);
    const expiry = this.authErrorEndpoints.get(key);
    if (!expiry) return false;
    if (Date.now() < expiry) return true;
    this.authErrorEndpoints.delete(key); // cooldown 到期，清除让下次首次 ERROR 可见
    return false;
  }

  private markEndpointAuthFailed(provider: string, baseUrl?: string): void {
    const key = this.endpointAuthKey(provider, baseUrl);
    this.authErrorEndpoints.set(
      key,
      Date.now() + EmbeddingService.AUTH_COOLDOWN_PER_ENDPOINT_MS,
    );
  }

  /**
   * 熔断器状态：返回 true = 当前打开（拒绝调用），false = 关闭
   */
  private isCircuitOpen(): boolean {
    const now = Date.now();
    if (this.circuitOpenUntil > now) return true;
    // 清理 window 外的失败时间戳
    this.rateLimitFailures = this.rateLimitFailures.filter(
      (ts) => now - ts < EmbeddingService.CIRCUIT_WINDOW_MS,
    );
    return false;
  }

  private recordRateLimitFailure(): void {
    const now = Date.now();
    this.rateLimitFailures.push(now);
    this.rateLimitFailures = this.rateLimitFailures.filter(
      (ts) => now - ts < EmbeddingService.CIRCUIT_WINDOW_MS,
    );
    if (this.rateLimitFailures.length >= EmbeddingService.CIRCUIT_THRESHOLD) {
      this.circuitOpenUntil = now + EmbeddingService.CIRCUIT_OPEN_DURATION_MS;
      this.logger.warn(
        `[embedding] circuit-open: ${this.rateLimitFailures.length} 429s in ${EmbeddingService.CIRCUIT_WINDOW_MS}ms; cooling for ${EmbeddingService.CIRCUIT_OPEN_DURATION_MS}ms`,
      );
      this.rateLimitFailures = []; // 打开后清空，避免反复触发
    }
  }

  /**
   * 根据 provider 推断 API 格式（与 AiModelConfigService.inferApiFormat 一致）
   */
  /**
   * ★ 2026-05-12: 写 user_api_keys.usage_count / lastUsedAt / testStatus 的桥。
   *
   * fire-and-forget——DB 写失败不该阻断 embedding 主路径，persistOutcome 自身
   *   有 try/catch 不会重抛。system 路径（无 healthKeyId）跳过。
   *
   * 为啥这里要写：LLM chat 走 KeyExecutor.execute 自动写；embedding 直接调
   *   callEmbeddingAPI 绕开 KeyExecutor，过去成功/失败全部无声，BYOK drawer
   *   永远看到 "0 hits / 未使用"。用户截图反馈 2026-05-12 暴露。
   */
  private trackKeyOutcome(
    config: EmbeddingModelConfig,
    outcome:
      | { ok: true }
      | {
          ok: false;
          classified: import("@/modules/platform/credentials/governance/key-health/key-error-classifier").ClassifiedError;
        },
  ): void {
    if (!config.healthKeyId) return; // system / cron 路径无 user-key
    void this.keyResolver
      .persistOutcome(config.healthKeyId, outcome)
      .catch((e) =>
        this.logger.warn(
          `[embedding] persistOutcome failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
  }

  private resolveApiFormat(
    dbApiFormat: string | null | undefined,
    provider: string,
  ): string {
    const inferred = this.inferApiFormat(provider);
    if (!dbApiFormat) return inferred;
    if (dbApiFormat === inferred) return dbApiFormat;
    // 非 openai provider 存了 openai format 视为配置错误
    if (dbApiFormat === "openai" && inferred !== "openai") {
      this.logger.warn(
        `[resolveApiFormat] apiFormat="${dbApiFormat}" conflicts with provider="${provider}", using inferred "${inferred}"`,
      );
      return inferred;
    }
    return dbApiFormat;
  }

  private inferApiFormat(provider: string): string {
    const lower = provider.toLowerCase();
    if (lower === "google" || lower === "gemini") return "google";
    if (lower === "cohere") return "cohere";
    return "openai"; // OpenAI, xAI, DeepSeek 等都走 OpenAI 兼容格式
  }

  /**
   * 从数据库加载 Embedding 模型配置
   *
   * ★ 2026-05-12 严格 BYOK 改造（用户反馈"统一使用 BYOK，绝不用系统 KEY"）：
   *
   *   有 userId（用户上下文：KB 处理 / RAG 检索 / AI-Ask）：
   *   1. **BYOK-first 模型选择**：按用户配的 BYOK 选模型，不被 admin default 主导
   *      a. user_api_keys.preferredModelId 命中 EMBEDDING 模型 → 用该模型
   *      b. user_api_keys.provider 匹配 ai_models.provider 且 modelType=EMBEDDING → 用该模型（isDefault 优先）
   *      c. KeyAssignment（admin 授权）的 EMBEDDING 模型 → 用该模型
   *   2. **拿 BYOK key**：keyResolver.resolveKey 走 PERSONAL → ASSIGNED 链
   *   3. **严格 BYOK**：用户没 BYOK 也没 ASSIGNED → 抛 ServiceUnavailable 引导去配置页
   *      （**不**再软回退 SYSTEM Secret，原来的"避免老 KB 崩"现在改为明确报错）
   *
   *   无 userId（background cron / 无用户上下文的系统任务）：
   *   - 走原 admin default 模型 + SYSTEM Secret / env 兜底
   *
   *   Cache 按 userId 隔离，TTL 60s；BYOK 配置变更触发 @OnEvent 即时清除。
   */
  async getEmbeddingConfig(
    userIdOverride?: string,
  ): Promise<EmbeddingModelConfig> {
    const userId = userIdOverride ?? RequestContext.getUserId() ?? undefined;
    const cacheKey = userId ?? EmbeddingService.SYSTEM_CACHE_KEY;

    const cached = this.cachedConfigByUser.get(cacheKey);
    if (cached && Date.now() - cached.time < this.CONFIG_CACHE_TTL) {
      return cached.config;
    }

    // 唯一 BYOK 选模型入口——所有 AI 入口都走它
    const model = await this.aiModelConfig.pickBYOKModelForUser(
      "EMBEDDING",
      userId,
    );
    if (!model) {
      if (userId) {
        throw new ServiceUnavailableException(
          "未配置 EMBEDDING 模型 BYOK。请到「BYOK 配置」页面为支持向量化的 provider（如 Google / OpenAI / Voyage）配置 API Key，或向管理员申请使用授权。",
        );
      }
      // 无 userId 且 system 兜底也没 → env
      const envApiKey = this.configService
        .get<string>("OPENAI_API_KEY")
        ?.trim();
      if (!envApiKey) {
        throw new ServiceUnavailableException(
          "No embedding model configured. Set OPENAI_API_KEY or configure an EMBEDDING model.",
        );
      }
      const fallbackConfig: EmbeddingModelConfig = {
        modelId: DEFAULT_EMBEDDING_MODEL,
        dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
        apiKey: envApiKey,
        provider: "openai",
        apiFormat: "openai",
      };
      this.cachedConfigByUser.set(cacheKey, {
        config: fallbackConfig,
        time: Date.now(),
      });
      return fallbackConfig;
    }

    // 拿 key：userId 走 BYOK keyResolver；无 userId 走 system Secret（cron）
    let apiKey: string;
    let apiEndpoint: string | undefined = model.apiEndpoint ?? undefined;
    let keySource: string = model.source;
    let healthKeyId: string | undefined;
    if (userId) {
      try {
        const resolved = await this.keyResolver.resolveKey(
          userId,
          model.provider.toLowerCase(),
        );
        apiKey = resolved.apiKey.trim();
        apiEndpoint = resolved.apiEndpoint ?? apiEndpoint;
        keySource = resolved.source;
        healthKeyId = resolved.healthKeyId;
      } catch (err) {
        if (err instanceof NoAvailableKeyError) {
          throw new ServiceUnavailableException(
            `未配置 provider "${model.provider}" 的 BYOK Key。请到「BYOK 配置」页面添加，或向管理员申请。`,
          );
        }
        throw err;
      }
    } else {
      // system 兜底（仅 background cron / 无 userId）：用 pickBYOKModelForUser 返回的 secretKey
      if (!model.secretKey) {
        // 没 secretKey → env 兜底
        const envApiKey = this.configService
          .get<string>("OPENAI_API_KEY")
          ?.trim();
        if (!envApiKey) {
          throw new ServiceUnavailableException(
            `System EMBEDDING model ${model.modelId} has no secretKey, OPENAI_API_KEY env not set.`,
          );
        }
        apiKey = envApiKey;
      } else {
        const secretValue = await this.secretsService.getValueInternal(
          model.secretKey,
        );
        if (!secretValue) {
          // Secret Manager 没找到 → env 兜底
          const envApiKey = this.configService
            .get<string>("OPENAI_API_KEY")
            ?.trim();
          if (!envApiKey) {
            throw new ServiceUnavailableException(
              `Secret '${model.secretKey}' not found for ${model.modelId}.`,
            );
          }
          apiKey = envApiKey;
        } else {
          apiKey = secretValue.trim();
        }
      }
    }

    const apiFormat = this.resolveApiFormat(model.apiFormat, model.provider);
    const config: EmbeddingModelConfig = {
      modelId: model.modelId,
      dimensions: model.embeddingDimensions || DEFAULT_EMBEDDING_DIMENSIONS,
      apiKey,
      apiEndpoint,
      provider: model.provider,
      apiFormat,
      maxInputTokens: model.maxInputTokens || undefined,
      healthKeyId,
    };
    this.cachedConfigByUser.set(cacheKey, { config, time: Date.now() });
    this.logger.log(
      `Loaded embedding config: ${model.modelId} (${config.dimensions}D, format=${apiFormat}, source=${keySource}, userScope=${userId ?? "system"})`,
    );
    return config;
  }

  /**
   * 清除单个用户的 embedding config cache（BYOK 配置变更时立即生效）
   */
  clearConfigCacheForUser(userId: string): void {
    if (this.cachedConfigByUser.delete(userId)) {
      this.logger.log(`Embedding config cache cleared for user ${userId}`);
    }
  }

  /**
   * BYOK 配置变更事件（user-api-keys.changed）→ 清除该用户 embedding cache
   * 让 BYOK 修改后下次 embedding 调用立即用新配置，不等 60s TTL。
   */
  @OnEvent("user-api-key.changed")
  handleUserApiKeyChanged(payload: { userId: string }): void {
    if (payload?.userId) this.clearConfigCacheForUser(payload.userId);
  }

  /**
   * 清除配置缓存（所有用户的）
   */
  clearConfigCache(): void {
    this.cachedConfigByUser.clear();
    this.logger.log("Embedding config cache cleared (all users)");
  }

  /**
   * 生成单个文本的嵌入
   *
   * ★ 2026-05-12: 加 options 让查询侧 caller 传 taskType:"query"
   */
  async generateEmbedding(
    text: string,
    options?: EmbeddingCallOptions,
  ): Promise<EmbeddingResult> {
    const result = await this.generateEmbeddings([text], options);
    return {
      text,
      embedding: result.embeddings[0],
      tokenCount: result.totalTokens,
    };
  }

  /**
   * 批量生成嵌入
   * ★ 通过 apiFormat 路由到 AiApiCallerService 对应方法
   *
   * @param texts 待嵌入文本
   * @param options 调用选项，详见 EmbeddingCallOptions
   */
  async generateEmbeddings(
    texts: string[],
    options?: EmbeddingCallOptions,
  ): Promise<EmbeddingBatch> {
    if (texts.length === 0) {
      return { texts: [], embeddings: [], totalTokens: 0 };
    }

    const config = await this.getEmbeddingConfig();

    // v5.1 R0.5-E B-#6 (2026-05-05): EMBEDDING_REQUEST hook seam
    //   plugin 可：(a) 缓存命中时 abort 注入 cached 结果；(b) 切换 fallback provider；
    //   (c) 注入测试 fixture（spec/dev）。无 plugin 注册时 zero-cost fast-path。
    if (this.hookBus) {
      const requestPayload = {
        inputs: texts,
        modelId: config.modelId,
        provider: config.provider,
        dimensions: config.dimensions,
      };
      try {
        return await this.hookBus.fire(
          "engine.embedding.request",
          requestPayload,
          () => this.generateEmbeddingsTerminal(texts, config, options),
        );
      } catch (err) {
        // HookAbortError 携带 cached payload 时，让 plugin 的 abortPayload 直接当结果
        const abortPayload = (err as { abortPayload?: EmbeddingBatch })
          ?.abortPayload;
        if (abortPayload && Array.isArray(abortPayload.embeddings)) {
          return abortPayload;
        }
        throw err;
      }
    }
    return this.generateEmbeddingsTerminal(texts, config, options);
  }

  /**
   * EMBEDDING_REQUEST hook 包装的实际 terminal —— 原 generateEmbeddings 主体。
   */
  private async generateEmbeddingsTerminal(
    texts: string[],
    config: EmbeddingModelConfig,
    options?: EmbeddingCallOptions,
  ): Promise<EmbeddingBatch> {
    const allEmbeddings: number[][] = [];
    let totalTokens = 0;

    // Cohere has a lower batch limit (96) than OpenAI/Google (100)
    const batchSize =
      config.apiFormat === "cohere" ? COHERE_MAX_BATCH_SIZE : MAX_BATCH_SIZE;

    // ★ 2026-05-04 熔断器前置检查：circuit open 期间直接 throw，让上游 fallback
    if (this.isCircuitOpen()) {
      throw new Error(
        `Embedding circuit-open (${this.rateLimitFailures.length} recent 429s). Upstream rate-limit cooldown until ${new Date(this.circuitOpenUntil).toISOString()}`,
      );
    }

    // ★ 2026-05-05 P0 修复：401 cooldown 期间直接 throw，不发请求 + 不刷 ERROR
    // ★ P5 per-endpoint 隔离 (2026-05-06): 改为 per-endpoint 熔断（而非全局
    //   authFailedUntil），UserA 配错的 OpenAI key 不影响 UserB 的 Google 调用。
    //   authErrorEndpoints Map 同时承担：(a) 日志去重；(b) per-endpoint 熔断。
    if (this.isEndpointAuthCoolingDown(config.provider, config.apiEndpoint)) {
      throw new Error(
        `Embedding auth-circuit-open for ${config.provider} (key invalid). Cooldown in effect. Update key in Admin > AI Models.`,
      );
    }

    // ★ 2026-05-12: 允许 caller 关闭内层 retry（推荐当 caller 自带 TPM-aware
    //   节流时，如 embedding-processor.service.ts）。否则 1 个外层 batch 在 ~4s
    //   内打 3 个 HTTP 给 Google → 必然 429 + quota window 污染。
    const maxRetries = Math.max(
      1,
      Math.min(
        options?.maxRetries ?? EmbeddingService.RETRY_MAX_ATTEMPTS,
        EmbeddingService.RETRY_MAX_ATTEMPTS,
      ),
    );

    // Process in batches
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);

      // ★ 2026-05-04 加 retry + 指数退避（caller 可通过 options.maxRetries 控制）
      let lastError: unknown;
      let succeeded = false;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          const result = await this.callEmbeddingAPI(config, batch, options);
          allEmbeddings.push(...result.embeddings);
          totalTokens += result.totalTokens;
          this.logger.debug(
            `Generated embeddings for batch ${Math.floor(i / batchSize) + 1} using ${config.modelId} (${config.apiFormat} format)${attempt > 0 ? ` (attempt ${attempt + 1})` : ""}`,
          );
          // ★ 2026-05-12: 命中后写 user_api_keys.usage_count / last_used_at /
          //   test_status='success'，让 BYOK drawer 看到真实统计。
          this.trackKeyOutcome(config, { ok: true });
          succeeded = true;
          break;
        } catch (error) {
          lastError = error;
          if (this.isRateLimitError(error)) {
            this.recordRateLimitFailure();
            // 熔断打开后立即终止重试链
            if (this.isCircuitOpen()) break;
            if (attempt < maxRetries - 1) {
              const delayMs =
                EmbeddingService.RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
              this.logger.warn(
                `[embedding] 429 (attempt ${attempt + 1}/${maxRetries}), backing off ${delayMs}ms`,
              );
              await new Promise((r) => setTimeout(r, delayMs));
              continue;
            }
          }
          // ★ 2026-05-05 P0 修复：401 立即触发 auth circuit-break + invalidate
          //   cache。不刷 524 次 ERROR，让 admin 改 key 后下次能立刻生效。
          // ★ 全覆盖审计修 (2026-05-06): 高并发 per-endpoint 去重——
          //   第一次 401 → ERROR；cooldown 期内 → DEBUG 不刷屏；
          //   支持多 provider/baseUrl 各自独立 cooldown。
          if (this.isAuthError(error)) {
            this.clearConfigCache();
            if (
              !this.isEndpointAuthCoolingDown(
                config.provider,
                config.apiEndpoint,
              )
            ) {
              // 第一次 401：打 ERROR（运维可见）+ 开始 cooldown
              this.markEndpointAuthFailed(config.provider, config.apiEndpoint);
              this.logger.error(
                `[embedding] 401 auth failed for ${config.modelId} (${config.apiFormat}). ` +
                  `Key invalid or expired. Auth-circuit-open for ${EmbeddingService.AUTH_FAILURE_COOLDOWN_MS / 1000}s. ` +
                  `Update key in Admin > AI Models. Original error: ${error instanceof Error ? error.message : String(error)}`,
              );
            } else {
              // cooldown 期内：降为 DEBUG，不重复刷屏
              this.logger.debug(
                `[embedding] 401 suppressed (within cooldown) for ${config.provider} ${config.apiEndpoint ?? ""}`,
              );
            }
          }
          // 非 429 不重试，直接抛
          break;
        }
      }
      if (!succeeded) {
        // ★ 2026-05-12: 写 user_api_keys.test_status='failed' + last_error_code/message
        //   让 BYOK drawer 看到具体失效原因（401 → "未授权" / 429 → "限流" 等）。
        this.trackKeyOutcome(config, {
          ok: false,
          classified: this.keyErrorClassifier.classify(lastError),
        });
        // ★ 2026-05-05 P0 修复：401 已经在 catch 内打过 ERROR + 触发 circuit-break，
        //   这里只 debug，避免双重刷屏；其他错误正常 ERROR
        if (this.isAuthError(lastError)) {
          this.logger.debug(
            `[embedding] auth error finalized (already logged once + circuit-open)`,
          );
        } else {
          this.logger.error(
            `Failed to generate embeddings with ${config.modelId} (${config.apiFormat}) after retries: ${lastError}`,
          );
        }
        throw lastError;
      }
    }

    return {
      texts,
      embeddings: allEmbeddings,
      totalTokens,
    };
  }

  /**
   * 根据 apiFormat 路由到对应的 embedding API
   *
   * ★ 2026-05-12 (二弹): 传 taskType + dimensions 给 provider 端：
   *   - Cohere → input_type ("search_document" / "search_query" / 等)
   *   - Google → task_type ("RETRIEVAL_DOCUMENT" / "RETRIEVAL_QUERY" / 等)
   *   - OpenAI → 只传 dimensions（OpenAI 不支持 task_type，会忽略）
   *   - Voyage 走 openai-compat 默认分支，input_type 暂不传——
   *     如需 Voyage 完整支持，新增 apiFormat="voyage" 分支
   */
  private async callEmbeddingAPI(
    config: EmbeddingModelConfig,
    inputs: string[],
    options?: EmbeddingCallOptions,
  ) {
    const taskType = options?.taskType ?? "document";
    const dimensions = options?.dimensions ?? config.dimensions;
    switch (config.apiFormat) {
      case "google":
        return this.aiApiCallerService.callGoogleEmbeddingAPI(
          config.apiEndpoint || "",
          config.apiKey,
          config.modelId,
          inputs,
          undefined,
          { taskType, dimensions },
        );
      case "cohere":
        return this.aiApiCallerService.callCohereEmbeddingAPI(
          config.apiEndpoint || "",
          config.apiKey,
          config.modelId,
          inputs,
          cohereInputType(taskType),
        );
      default:
        // openai, xai, deepseek 等都走 OpenAI 兼容格式
        return this.aiApiCallerService.callOpenAICompatibleEmbeddingAPI(
          config.apiEndpoint || "",
          config.apiKey,
          config.modelId,
          inputs,
          undefined,
          { dimensions },
        );
    }
  }

  /**
   * 获取嵌入维度
   */
  async getDimensions(): Promise<number> {
    const config = await this.getEmbeddingConfig();
    return config.dimensions;
  }

  /**
   * 获取当前模型名称
   */
  async getModel(): Promise<string> {
    const config = await this.getEmbeddingConfig();
    return config.modelId;
  }

  /**
   * 获取配置信息（用于诊断）
   */
  async getConfigInfo(): Promise<{
    modelId: string;
    dimensions: number;
    provider: string;
    apiFormat: string;
    hasApiKey: boolean;
    maxInputTokens?: number;
  }> {
    const config = await this.getEmbeddingConfig();
    return {
      modelId: config.modelId,
      dimensions: config.dimensions,
      provider: config.provider,
      apiFormat: config.apiFormat,
      hasApiKey: !!config.apiKey,
      maxInputTokens: config.maxInputTokens,
    };
  }
}
