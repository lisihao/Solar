import { Injectable, Logger, Optional } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { SecretsService } from "@/modules/platform/facade";
// PR-X9: BYOK 服务已搬到 platform/credentials/
import { KeyResolverService } from "@/modules/platform/credentials/resolution/key-resolver/key-resolver.service";
import { NoAvailableKeyError } from "@/modules/platform/credentials/resolution/key-resolver/key-resolver.errors";
import { UserApiKeysService } from "@/modules/platform/credentials/user-owned/user-api-keys/user-api-keys.service";
import { UserModelConfigsService } from "@/modules/platform/credentials/user-owned/user-model-configs/user-model-configs.service";
import { RequestContext } from "@/common/context/request-context";
import { LruMap } from "@/common/utils/lru-map";
import { AIModel, AIModelType, UserModelConfig } from "@prisma/client";
import { inferIsReasoning } from "../../types";
// v3.1 A0：AIModelConfig 单一源已迁出至 types/model-config.types.ts；
// 本文件 import 后再 re-export，向后兼容旧 `from "./ai-model-config.service"`
// 路径上的下游消费方。
import type {
  AIModelConfig,
  ApiKeySource,
  ResolvedApiKey,
} from "../../types/model-config.types";
// v3.1 B.2: capability_overrides JSONB 严校（safeParse 失败仅 warn 跳过）
// 解析逻辑独立在 capability-overrides-parser（review 2026-05-24 Fix-3 防 god-class）
import { parseCapabilityOverrides } from "../capability/capability-overrides-parser";
import {
  isNonTextGenerationModelId,
  TEXT_MODEL_TYPES,
} from "../selection/default-recommendations.config";

export type { AIModelConfig, ApiKeySource, ResolvedApiKey };

/**
 * 图像生成模型 modelId 命名启发式 —— 用于把被误标为 CHAT 的图像模型
 * （如 grok-imagine-image）排出文本/对话 failover 候选。仅对非 IMAGE 类型查询生效。
 */
const IMAGE_MODEL_ID_PATTERN =
  /(image|imagine|dall-?e|flux|stable-?diffusion|sd-?xl|midjourney|ideogram)/i;

/**
 * 2026-05-12 严格 BYOK 升级（用户政策："所有 AI 调用统一 BYOK，绝不用 admin"）：
 * 不再有"基础功能必需"的软回退例外。**所有 modelType 一律严格**：
 * - 有 userId 上下文：必须从 UserModelConfig（BYOK）选；没配 → 返回空
 * - 无 userId 上下文（background cron）：才允许 admin AIModel 兜底
 *
 * 原 BYOK_OPTIONAL_TYPES 集合已废弃保留作向后兼容标记，逻辑层不再读取。
 */
// 2026-05-12 严格 BYOK：原 BYOK_OPTIONAL_TYPES 区分已废弃，所有 modelType 一律严格。
// 保留 import AIModelType 引用（其他方法签名需要）。

/**
 * AI 模型配置管理服务
 * 负责：模型配置的缓存、读取、选择和推断
 */
@Injectable()
export class AiModelConfigService {
  private readonly logger = new Logger(AiModelConfigService.name);

  // ==================== 模型配置缓存 ====================
  // 从数据库加载的模型配置缓存
  private modelConfigCache = new Map<string, AIModelConfig>();
  private modelConfigCacheTime = 0;
  private readonly MODEL_CONFIG_CACHE_TTL = 5 * 60 * 1000; // 5 分钟缓存
  // 防 stampede：并发刷新时共享同一个 Promise
  private refreshPromise: Promise<void> | null = null;

  // ★ BYOK 解析缓存：按 (userId, modelId) 缓存 getModelById 结果。
  //   背景：BYOK 模型（UserModelConfig / synthesized）不在上面的 5min 全量缓存里，
  //   getModelById 每次都跑一长串串行 DB fallback（缓存未命中 → 直查 → findUserModelConfig
  //   → findDisabledModelForUser → synthesizeConfigForUserModel）。在高 DB-RTT 部署上
  //   单次解析可达数秒，且每条消息都重跑。命中缓存即可跳过整条链。
  //   只缓存「配置」（endpoint / modelId / 参数），不含密钥——apiKey 仍由 resolveApiKey
  //   在调用时实时解析，故缓存不会泄露或固化凭证。
  //
  //   TTL=5min（与 modelConfigCache 对齐）。原先压到 60s 是因为担心改配后陈旧窗口，但
  //   用户侧的写路径现已全部接上失效（clearResolvedModelCache(userId)）：
  //     · UserModelConfig CRUD —— user-model-configs.controller
  //     · UserApiKey 存/删 key + 改 preferredModelId/endpoint —— user-api-keys.controller（M2 fix）
  //   故用户改自己的 BYOK 配置立即生效，与 TTL 无关。剩余「admin 改 AIModel」一类全局变更，
  //   本来就靠 modelConfigCache 的 5min TTL 传播（admin 写路径也不显式失效），这里取同样的
  //   5min 不引入比现状更长的陈旧窗口。换来 BYOK 冷解析次数降到原来的 ~1/5（每 5min 而非每会话）。
  private readonly resolvedModelCache = new LruMap<
    string,
    { config: AIModelConfig | null; time: number }
  >(2000);
  private readonly RESOLVED_MODEL_CACHE_TTL = 5 * 60 * 1000; // 5min（与 MODEL_CONFIG_CACHE_TTL 对齐）

  constructor(
    private readonly prisma: PrismaService,
    private readonly secretsService: SecretsService,
    private readonly userApiKeysService: UserApiKeysService,
    @Optional() private readonly keyResolver?: KeyResolverService,
    @Optional() private readonly userModelConfigs?: UserModelConfigsService,
  ) {
    // 初始化时异步加载模型配置
    this.refreshModelConfigCache().catch((err) =>
      this.logger.warn(`Failed to initialize model config cache: ${err}`),
    );
  }

  /**
   * 获取模型的 API Key（原有方法，保持向后兼容）
   * 不含用户 Key 优先级逻辑，仅使用系统 Key
   */
  async getApiKeyForModel(model: AIModelConfig): Promise<string | null> {
    const resolved = await this.resolveApiKey(model);
    return resolved?.apiKey || null;
  }

  /**
   * 获取模型的 API Key。
   *
   * BYOK v2 优先级（由 {@link KeyResolverService} 统一裁决）：
   * - 管理员（User.role = ADMIN）→ 仅系统 Secret
   * - 普通用户 → Personal → Assigned；两者都没有 → 返回 null（让调用方以
   *   "API Key not configured" 语义提示用户），不再静默回退到系统 Secret
   *
   * 没有 userId 的后台任务（过渡期保留）：走系统 Secret 的旧路径，保证现
   * 有定时任务在 Phase 4 改造完成前仍可运行。
   */
  async resolveApiKey(
    model: AIModelConfig,
    userId?: string,
  ): Promise<ResolvedApiKey | null> {
    if (userId && this.keyResolver) {
      try {
        const resolved = await this.keyResolver.resolveKey(
          userId,
          model.provider,
          {
            // 透传 AIModel 上记录的 secretKey，供管理员路径精确定位 Secret，
            // 避免因命名不规范（claude-api-key / gemini-api 等）查不到。
            systemSecretName: model.secretKey ?? null,
            // 2026-05-28 BYOK：用户为该模型选定的具体 UserApiKey.id（若有）
            preferredKeyId: model.apiKeyId ?? null,
          },
        );
        const sourceMap = {
          PERSONAL: "personal",
          ASSIGNED: "assigned", // W4a：原误标 "donated"，ASSIGNED 来源归一为 "assigned"
          SYSTEM: "system",
        } as const;
        return {
          apiKey: resolved.apiKey,
          source: sourceMap[resolved.source],
          apiEndpoint: resolved.apiEndpoint,
          healthKeyId: resolved.healthKeyId,
        };
      } catch (error) {
        if (error instanceof NoAvailableKeyError) {
          // 用户没有 Personal 也没有 Assignment：返回 null，让上层给出
          // "API Key not configured" 或透传 NO_AVAILABLE_KEY 错误
          return null;
        }
        // QuotaExceededError / NoSystemKeyError 等需要传给前端
        throw error;
      }
    }

    // 过渡期：无 userId 上下文时退化为系统 Secret 路径
    if (model.secretKey) {
      const secretValue = await this.secretsService.getValueInternal(
        model.secretKey,
      );
      if (secretValue) {
        return { apiKey: secretValue.trim(), source: "system" };
      }
      this.logger.error(
        `[resolveApiKey] Secret '${model.secretKey}' not found for model ${model.name}.`,
      );
    }
    return null;
  }

  /**
   * 根据 provider 推断 API 格式
   */
  private inferApiFormat(provider: string): string {
    const lower = provider.toLowerCase();
    if (lower === "anthropic" || lower === "claude") return "anthropic";
    if (lower === "google" || lower === "gemini") return "google";
    if (lower === "xai" || lower === "grok") return "xai";
    if (lower === "cohere") return "cohere";
    return "openai"; // 默认使用 OpenAI 兼容格式
  }

  /**
   * 解析 apiFormat：优先用数据库值，但当 provider 与 apiFormat 明显矛盾时以 provider 为准
   * 例如 provider=Google + apiFormat=openai 是配置错误，应自动修正为 google
   */
  private resolveApiFormat(
    dbApiFormat: string | null | undefined,
    provider: string,
    modelId: string,
  ): string {
    const inferred = this.inferApiFormat(provider);
    if (!dbApiFormat) return inferred;

    // 如果 DB 值与 provider 推断一致，直接返回
    if (dbApiFormat === inferred) return dbApiFormat;

    // 检测矛盾：非 openai provider 存了 openai format（常见配置错误）
    if (dbApiFormat === "openai" && inferred !== "openai") {
      this.logger.warn(
        `[resolveApiFormat] Model ${modelId}: apiFormat="${dbApiFormat}" conflicts with provider="${provider}", using inferred "${inferred}"`,
      );
      return inferred;
    }

    // 反向矛盾：OpenAI 兼容 provider 存了非 openai format（如 OpenRouter 误存 "google"）
    if (dbApiFormat !== "openai" && inferred === "openai") {
      this.logger.warn(
        `[resolveApiFormat] Model ${modelId}: apiFormat="${dbApiFormat}" conflicts with OpenAI-compatible provider="${provider}", forcing "openai"`,
      );
      return "openai";
    }

    // 其他情况信任数据库值
    return dbApiFormat;
  }

  /**
   * 根据模型名称推断是否为推理模型
   * 当数据库中没有 isReasoning 字段时使用
   * ★ 委托给共享纯函数 inferIsReasoning()
   */
  private inferIsReasoning(modelId: string): boolean {
    return inferIsReasoning(modelId);
  }

  /**
   * 从数据库模型构建 AIModelConfig
   * ★ 统一处理所有字段，兼容新旧数据库
   */
  private buildModelConfig(model: Record<string, unknown>): AIModelConfig {
    // 2026-06-10 P0：AIModel.isReasoning 列是 NOT NULL @default(false)，故"未标记"
    // 与"显式 false"在此层不可区分。对 reasoning 名模型（gpt-5.x/o1/o3/o4/...）做
    // 启发式 OR 兜底：DB true 直用；DB false 但模型名是 reasoning → 仍判 true，
    // 让下方 tokenParamName 走 max_completion_tokens，避免发 max_tokens 被 OpenAI
    // INVALID_REQUEST 全失败。代价：admin 若真想对 reasoning 名模型强制非推理，
    // 需显式设 tokenParamName=max_tokens（该字段直读，不被本兜底覆盖）。
    const isReasoning =
      (model.isReasoning as boolean | undefined) ||
      this.inferIsReasoning(model.modelId as string);

    return {
      id: model.id as string,
      name: model.name as string,
      displayName: model.displayName as string,
      provider: model.provider as string,
      modelId: model.modelId as string,
      apiEndpoint: model.apiEndpoint as string,
      // 2026-05-12 BYOK 单源：admin 兼容路径透传明文 apiKey；业务消费方走 KeyResolver, PR-4 收尾后删除.
      apiKey: (model.apiKey as string | null) || null,
      secretKey: (model.secretKey as string | null) || undefined, // ★ 添加 secretKey 以支持 Secret Manager
      maxTokens: model.maxTokens as number,
      temperature: model.temperature as number,
      isEnabled: model.isEnabled as boolean,
      isDefault: model.isDefault as boolean,

      // ★ 模型能力配置 - 优先使用数据库值，否则根据 isReasoning 推断
      isReasoning,
      apiFormat: this.resolveApiFormat(
        model.apiFormat as string | undefined,
        model.provider as string,
        model.modelId as string,
      ),
      // ★ reasoning 模型硬性拒绝 temperature；supportsTemperature 列 NOT NULL
      //   @default(true)，漏标 reasoning 塌缩 true → ?? 失效，故 reasoning 强制 false。
      supportsTemperature: isReasoning
        ? false
        : ((model.supportsTemperature as boolean | undefined) ?? true),
      supportsStreaming:
        (model.supportsStreaming as boolean | undefined) ?? true,
      supportsFunctionCalling:
        (model.supportsFunctionCalling as boolean | undefined) ?? true,
      supportsVision: (model.supportsVision as boolean | undefined) ?? false,
      tokenParamName:
        (model.tokenParamName as string | undefined) ??
        (isReasoning ? "max_completion_tokens" : "max_tokens"),
      defaultTimeoutMs:
        (model.defaultTimeoutMs as number | undefined) ??
        (isReasoning ? 300000 : 120000),
      priceInputPerMillion: model.priceInputPerMillion
        ? Number(model.priceInputPerMillion)
        : undefined,
      priceOutputPerMillion: model.priceOutputPerMillion
        ? Number(model.priceOutputPerMillion)
        : undefined,
      priority: (model.priority as number | undefined) ?? 50,

      // ★ 2026-05-06 Structured Output capability matrix
      structuredOutputStrategy:
        (model.structuredOutputStrategy as string | null | undefined) ?? null,
      fallbackStrategies: Array.isArray(model.fallbackStrategies)
        ? (model.fallbackStrategies as string[])
        : [],
      supportsJsonSchemaStrict:
        (model.supportsJsonSchemaStrict as boolean | undefined) ?? false,
      supportsJsonSchema:
        (model.supportsJsonSchema as boolean | undefined) ?? false,
      supportsToolUse: (model.supportsToolUse as boolean | undefined) ?? false,
      supportsJsonMode:
        (model.supportsJsonMode as boolean | undefined) ?? false,
      supportsGbnfGrammar:
        (model.supportsGbnfGrammar as boolean | undefined) ?? false,

      // v3.1 §3.4 优先级 #2：admin capability_overrides（JSONB，nullable）
      aiModelOverrides: parseCapabilityOverrides(model.capabilityOverrides, {
        kind: "admin",
        modelId: (model.modelId as string) ?? "<unknown>",
        logger: this.logger,
      }),
    };
  }

  /**
   * 刷新模型配置缓存
   * 从数据库加载所有启用的 CHAT 和 CHAT_FAST 模型配置
   * ★ 必须同时加载 CHAT_FAST，否则快速模型无法通过工具调用
   */
  async refreshModelConfigCache(): Promise<void> {
    try {
      // ★ 加载所有启用模型（不限类型），确保 MULTIMODAL/CODE 等类型的模型也能被 getModelConfig 找到
      const models = await this.prisma.aIModel.findMany({
        where: {
          isEnabled: true,
        },
      });

      this.modelConfigCache.clear();
      for (const model of models) {
        const config = this.buildModelConfig(model);
        // 使用 modelId 作为主键（如 "gpt-4o", "gemini-2.0-flash"）
        this.modelConfigCache.set(model.modelId, config);
        // 同时使用 name 作为别名（如 "grok", "claude"）
        if (model.name !== model.modelId) {
          this.modelConfigCache.set(model.name, config);
        }
      }

      this.modelConfigCacheTime = Date.now();
      this.logger.log(
        `[refreshModelConfigCache] Loaded ${models.length} enabled models from database`,
      );
    } catch (error) {
      this.logger.error(`[refreshModelConfigCache] Failed: ${error}`);
    }
  }

  /**
   * 检查 Temperature 参数是否支持（同步，从缓存读取）。
   *
   * v3.1 A0：合并自原 `AiChatModelConfigService.isTemperatureSupported`，
   * 走 canonical 单缓存。
   *
   * 优先级：
   *   1. DB 缓存的 supportsTemperature 字段（操作员显式声明）
   *   2. 回落 isReasoningModel() 的统一判断（推理模型不支持 temperature）
   *   3. 默认 true（普通模型支持）
   */
  isTemperatureSupported(modelId: string): boolean {
    // 1. DB 配置优先（精确匹配）
    const config = this.modelConfigCache.get(modelId);
    if (config?.supportsTemperature !== undefined) {
      return config.supportsTemperature;
    }

    // 2. 不区分大小写匹配
    const modelLower = modelId.toLowerCase();
    for (const [key, cfg] of this.modelConfigCache.entries()) {
      if (
        key.toLowerCase() === modelLower &&
        cfg.supportsTemperature !== undefined
      ) {
        return cfg.supportsTemperature;
      }
    }

    // 3. 推理模型不支持 temperature
    if (this.isReasoningModel(modelId)) {
      this.logger.debug(
        `[isTemperatureSupported] Model "${modelId}" is reasoning, temperature not supported`,
      );
      return false;
    }

    return true;
  }

  /**
   * 检查模型是否为推理模型
   * ★ 统一入口：优先使用数据库配置的 isReasoning 字段，否则推断
   * @param modelId 模型 ID
   * @returns 是否为推理模型
   */
  isReasoningModel(modelId: string): boolean {
    // 1. 从缓存获取配置（同步方法，缓存应该已经加载）
    const config = this.modelConfigCache.get(modelId);
    if (config?.isReasoning !== undefined) {
      return config.isReasoning;
    }

    // 2. 尝试不区分大小写匹配
    const modelLower = modelId.toLowerCase();
    for (const [key, cfg] of this.modelConfigCache.entries()) {
      if (key.toLowerCase() === modelLower && cfg.isReasoning !== undefined) {
        return cfg.isReasoning;
      }
    }

    // 3. 缓存未命中，使用名称推断（兼容旧数据）
    return this.inferIsReasoning(modelId);
  }

  /**
   * 获取模型配置（优先从数据库，缓存 5 分钟）
   * @param modelId 模型 ID（如 "gpt-4o", "gemini-2.0-flash", "claude-3-opus"）
   */
  async getModelConfig(modelId: string): Promise<AIModelConfig | null> {
    // 检查缓存是否过期，共享 Promise 防止并发 stampede
    if (Date.now() - this.modelConfigCacheTime > this.MODEL_CONFIG_CACHE_TTL) {
      if (!this.refreshPromise) {
        this.refreshPromise = this.refreshModelConfigCache().finally(() => {
          this.refreshPromise = null;
        });
      }
      await this.refreshPromise;
    }

    // ★ 预处理：去掉可能的 #N 后缀（AI 可能误生成的无效后缀）
    const normalizedModelId = modelId.replace(/#\d+$/, "");
    if (normalizedModelId !== modelId) {
      this.logger.debug(
        `[getModelConfig] Normalized modelId: "${modelId}" -> "${normalizedModelId}"`,
      );
    }

    // 1. 精确匹配（区分大小写）- 先尝试原始 ID，再尝试规范化后的 ID
    if (this.modelConfigCache.has(modelId)) {
      return this.modelConfigCache.get(modelId)!;
    }
    if (
      normalizedModelId !== modelId &&
      this.modelConfigCache.has(normalizedModelId)
    ) {
      return this.modelConfigCache.get(normalizedModelId)!;
    }

    // 2. 精确匹配（不区分大小写）
    const modelLower = normalizedModelId.toLowerCase();
    for (const [key, config] of this.modelConfigCache.entries()) {
      if (key.toLowerCase() === modelLower) {
        return config;
      }
    }

    // 3/4/5. ★ 缓存全 miss 后的 DB fallback。三条查找互相独立（enabled AIModel /
    //    UserModelConfig / disabled AIModel），原先串行 await 会把每次 DB RTT 叠加 ——
    //    在高 DB-RTT 部署上一次解析就要数秒。这里改成并行发起，墙钟从「RTT 之和」
    //    压成「单次 RTT」，再按原优先级取首个命中，语义与串行完全一致。
    //    ★ 不限 modelType — getModelConfig 的职责是按 ID 查配置，类型过滤由调用方负责。
    const [enabledModel, userConfig, disabledConfig] = await Promise.all([
      this.queryEnabledAiModelByIdOrName(normalizedModelId),
      this.findUserModelConfigByModelId(normalizedModelId),
      this.findDisabledModelForUser(normalizedModelId),
    ]);

    // 3. enabled AIModel（最高优先级）
    if (enabledModel) {
      // ★ 使用统一的 buildModelConfig 方法
      const config = this.buildModelConfig(enabledModel);
      this.modelConfigCache.set(normalizedModelId, config);
      // 同时缓存 modelId 和 name 以提高后续查找效率
      if (enabledModel.modelId !== normalizedModelId) {
        this.modelConfigCache.set(enabledModel.modelId, config);
      }
      if (
        enabledModel.name !== normalizedModelId &&
        enabledModel.name !== enabledModel.modelId
      ) {
        this.modelConfigCache.set(enabledModel.name, config);
      }
      return config;
    }

    // 4. ★ BYOK v3: 用户自定义模型配置（UserModelConfig 表）
    if (userConfig) return userConfig;

    // 5. ★ BYOK: disabled 模型（用户有对应 provider 的 Key 时可用）
    if (disabledConfig) return disabledConfig;

    // 6. ★ BYOK: 用户只填了 UserApiKey.preferredModelId 但没建 UserModelConfig
    //    时的向后兼容路径 —— 用 provider 默认参数合成一个 AIModelConfig。
    //    合成路径最贵（多次 key 查询），且优先级最低，仅在前 3 条全 miss 时才跑。
    const synthesized =
      await this.synthesizeConfigForUserModel(normalizedModelId);
    if (synthesized) return synthesized;

    return null;
  }

  /**
   * 按 modelId / name 精确查 enabled 的 AIModel（不区分大小写）。
   * 从 getModelConfig 的 DB fallback 抽出，便于与其它 BYOK 查找并行发起。
   * 自带 try/catch —— 失败回 null，保证并行 Promise.all 不会因单条查询异常整体 reject。
   */
  private async queryEnabledAiModelByIdOrName(
    modelId: string,
  ): Promise<AIModel | null> {
    try {
      return await this.prisma.aIModel.findFirst({
        where: {
          OR: [
            { modelId: { equals: modelId, mode: "insensitive" } },
            { name: { equals: modelId, mode: "insensitive" } },
          ],
          isEnabled: true,
        },
      });
    } catch (error) {
      this.logger.warn(`[getModelConfig] Database query failed: ${error}`);
      return null;
    }
  }

  /**
   * 查找用户自配的 UserModelConfig（按 modelId 精确匹配，不区分大小写）。
   * 命中时按用户的参数构造 AIModelConfig。
   */
  private async findUserModelConfigByModelId(
    modelId: string,
  ): Promise<AIModelConfig | null> {
    const userId = RequestContext.getUserId();
    if (!userId || !this.userModelConfigs) return null;
    try {
      const cfg = await this.userModelConfigs.findByModelId(userId, modelId);
      if (!cfg) return null;
      return this.toAIModelConfigFromUserConfig(cfg);
    } catch (error) {
      this.logger.warn(
        `[findUserModelConfigByModelId] Failed for ${userId}/${modelId}: ${error}`,
      );
      return null;
    }
  }

  /**
   * 查用户在指定 modelType 下的默认 UserModelConfig（供 chat 选初始模型）。
   */
  async findUserDefaultByType(
    userId: string,
    modelType: AIModelType,
  ): Promise<AIModelConfig | null> {
    if (!this.userModelConfigs) return null;
    try {
      const cfg = await this.userModelConfigs.findDefaultForType(
        userId,
        modelType,
      );
      if (!cfg) return null;
      return this.toAIModelConfigFromUserConfig(cfg);
    } catch (error) {
      this.logger.warn(
        `[findUserDefaultByType] Failed for ${userId}/${modelType}: ${error}`,
      );
      return null;
    }
  }

  /**
   * 2026-05-11 P2: 从硬编码 PROVIDER_API_DEFAULTS 改为 DB ai_providers 兜底，
   * cfg.apiEndpoint 优先（用户在 UserModelConfig 显式填的最高优先级）。
   */
  private async toAIModelConfigFromUserConfig(
    cfg: UserModelConfig,
  ): Promise<AIModelConfig> {
    const fallbackEndpoint = cfg.apiEndpoint
      ? cfg.apiEndpoint
      : ((await this.userApiKeysService.resolveProviderDefaults(cfg.provider))
          ?.endpoint ?? "");
    return {
      id: `user-model-config-${cfg.id}`,
      name: cfg.modelId,
      displayName: cfg.displayName,
      provider: cfg.provider,
      modelId: cfg.modelId,
      apiEndpoint: fallbackEndpoint,
      apiKey: null, // resolveApiKey 会用用户 Key
      secretKey: null,
      // 2026-05-28 BYOK：透传用户为该模型选定的具体 Key，runtime 优先用它
      apiKeyId: cfg.apiKeyId,
      maxTokens: cfg.maxTokens,
      temperature: cfg.temperature,
      isEnabled: cfg.isEnabled,
      isDefault: cfg.isDefault,
      isReasoning: cfg.isReasoning,
      apiFormat: cfg.apiFormat,
      supportsTemperature: cfg.supportsTemperature,
      supportsStreaming: cfg.supportsStreaming,
      supportsFunctionCalling: cfg.supportsFunctionCalling,
      supportsVision: cfg.supportsVision,
      tokenParamName: cfg.tokenParamName,
      defaultTimeoutMs: cfg.defaultTimeoutMs,
      priceInputPerMillion: cfg.priceInputPerMillion
        ? Number(cfg.priceInputPerMillion)
        : undefined,
      priceOutputPerMillion: cfg.priceOutputPerMillion
        ? Number(cfg.priceOutputPerMillion)
        : undefined,
      priority: cfg.priority,

      // v3.1 §3.4 优先级 #1：BYOK user capability_overrides（JSONB，nullable）
      userOverrides: parseCapabilityOverrides(cfg.capabilityOverrides, {
        kind: "user",
        modelId: cfg.modelId ?? "<unknown>",
        logger: this.logger,
      }),
    };
  }

  // 2026-05-11 P2: PROVIDER_API_DEFAULTS 硬编码已删。synthesizeConfigForUserModel
  // 走 userApiKeysService.resolveProviderDefaults（DB ai_providers 唯一真源）。

  private async synthesizeConfigForUserModel(
    modelId: string,
  ): Promise<AIModelConfig | null> {
    const userId = RequestContext.getUserId();
    if (!userId) return null;

    // 用户为哪个 provider 配过 Key，就认为这个 modelId 属于那个 provider。
    // 这里不做复杂推断（避免把 "gpt-4o" 误绑到其他 OpenAI-compatible provider）
    // —— 只要用户配了某 provider 的 Key + preferredModelId 匹配就走合成。
    const providers =
      await this.userApiKeysService.getAvailableProviders(userId);

    // 各 provider 的 personal key 互相独立，原先 for-await 逐个串行查在高 DB-RTT
    // 部署上会叠成数秒。并行取回后，按 providers 原顺序找首个 preferredModelId 命中
    // 的 provider —— 与串行版「第一个匹配即返回」语义一致。
    const personalKeys = await Promise.all(
      providers.map((provider) =>
        this.userApiKeysService
          .getPersonalKey(userId, provider)
          .then((key) => ({ provider, key })),
      ),
    );
    const match = personalKeys.find(
      ({ key }) =>
        key?.preferredModelId &&
        key.preferredModelId.toLowerCase() === modelId.toLowerCase(),
    );
    if (!match?.key) return null;

    const { provider } = match;
    const personal = match.key;
    // 2026-05-11 P2: 从 DB ai_providers 拿默认 endpoint/apiFormat，
    // 找不到时 personal.apiEndpoint 必填（用户配 Key 时已强制要求）。
    const defaults = (await this.userApiKeysService.resolveProviderDefaults(
      provider,
    )) ?? {
      endpoint: "",
      apiFormat: "openai",
      testModel: "",
    };
    this.logger.log(
      `[synthesizeConfigForUserModel] Synthesizing config for user ` +
        `${userId}: provider=${provider}, modelId=${modelId}`,
    );
    const synthesized: AIModelConfig = {
      id: `user-${userId}-${provider}-${modelId}`,
      name: modelId,
      displayName: modelId,
      provider,
      modelId,
      apiEndpoint: personal.apiEndpoint || defaults.endpoint,
      apiKey: null, // resolveApiKey 会用用户 Key
      secretKey: null,
      maxTokens: 8192,
      temperature: 0.7,
      isEnabled: true,
      isDefault: false,
      isReasoning: inferIsReasoning(modelId),
      apiFormat: defaults.apiFormat,
      supportsTemperature: true,
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsVision: false,
      tokenParamName: inferIsReasoning(modelId)
        ? "max_completion_tokens"
        : "max_tokens",
      defaultTimeoutMs: 120000,
      priority: 0,
    };

    // ★ 惰性自动注册：把首次合成的 BYOK 模型落成正式 UserModelConfig，之后该
    //   (user, modelId) 的解析直接命中 findUserModelConfigByModelId（1 次 DB），
    //   不再跑整条 synthesize 兜底链——冷解析成本一辈子只付一次，无需用户/admin
    //   手动注册。fire-and-forget，不阻塞本次返回；helper 自带 try/catch。
    void this.persistSynthesizedAsUserModelConfig(userId, synthesized);

    return synthesized;
  }

  /**
   * 把 synthesize 出来的 BYOK 模型持久化成正式 UserModelConfig。
   *
   * 直接落 synthesize 已算好的字段（endpoint / apiFormat / isReasoning /
   * tokenParamName 等），不重新推断 —— 保证持久化行与本次运行时配置完全一致，
   * 避免推断漂移（历史上 xAI 模型被推断成 openai 格式导致路由错的那类坑）。
   *
   * dedup：synthesize 仅在 findUserModelConfigByModelId 已 miss 后才会执行，故首次
   * 必无重复行；并发重复由 UserModelConfig 唯一约束（P2002 → ConflictException）兜底。
   * 任何失败都不影响解析，静默降级。
   */
  private async persistSynthesizedAsUserModelConfig(
    userId: string,
    cfg: AIModelConfig,
  ): Promise<void> {
    if (!this.userModelConfigs) return;
    try {
      await this.userModelConfigs.create(userId, {
        provider: cfg.provider,
        modelId: cfg.modelId,
        displayName: cfg.displayName ?? cfg.modelId,
        // findByModelId 按 (userId, modelId) 查、不过滤 modelType，CHAT 即可覆盖
        modelType: AIModelType.CHAT,
        apiEndpoint: cfg.apiEndpoint || null,
        maxTokens: cfg.maxTokens,
        isReasoning: cfg.isReasoning,
        apiFormat: cfg.apiFormat,
        supportsTemperature: cfg.supportsTemperature,
        supportsStreaming: cfg.supportsStreaming,
        supportsFunctionCalling: cfg.supportsFunctionCalling,
        supportsVision: cfg.supportsVision,
        tokenParamName: cfg.tokenParamName,
        defaultTimeoutMs: cfg.defaultTimeoutMs,
        isDefault: false, // 不抢用户已有默认
        isEnabled: true,
      });
      this.logger.log(
        `[synthesizeConfigForUserModel] Lazily registered BYOK model as ` +
          `UserModelConfig: user=${userId} ${cfg.provider}/${cfg.modelId}`,
      );
      // 解析结果变了（synthesized → UserModelConfig 行），清掉本用户解析缓存让下次回源
      this.clearResolvedModelCache(userId);
    } catch (error) {
      // P2002 并发重复 → ConflictException；其余失败也不影响解析，静默
      this.logger.debug(
        `[synthesizeConfigForUserModel] Lazy-register skipped for ` +
          `${cfg.modelId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 获取默认模型配置
   */
  async getDefaultModelConfig(): Promise<AIModelConfig | null> {
    try {
      const model = await this.prisma.aIModel.findFirst({
        where: {
          modelType: "CHAT",
          isEnabled: true,
          isDefault: true,
        },
        orderBy: {
          priority: "desc",
        },
      });

      if (model) {
        return this.buildModelConfig(model);
      }

      // 如果没有默认模型，返回第一个启用的模型
      const fallback = await this.prisma.aIModel.findFirst({
        where: {
          modelType: "CHAT",
          isEnabled: true,
        },
        orderBy: {
          priority: "desc",
        },
      });

      return fallback ? this.buildModelConfig(fallback) : null;
    } catch (error) {
      this.logger.error(`[getDefaultModelConfig] Failed: ${error}`);
      return null;
    }
  }

  /**
   * 根据类型获取默认模型
   * @param modelType 模型类型（CHAT, EMBEDDING, IMAGE, etc.）
   *
   * 2026-05-12 严格 BYOK：有 userId 上下文时**只**从用户 UserModelConfig 选；
   * 用户没配 → 返回 null（上层 throw 引导 BYOK 配置）。
   * 无 userId（background cron）→ admin AIModel 兜底（保留）。
   */
  async getDefaultModelByType(
    modelType: AIModelType,
  ): Promise<AIModelConfig | null> {
    try {
      const userId = RequestContext.getUserId();

      if (userId) {
        // 严格 BYOK：直接走 getAllEnabledModelsByType（已做用户 BYOK 选择）
        const models = await this.getAllEnabledModelsByType(modelType);
        if (models.length > 0) return models[0];
        this.logger.warn(
          `[getDefaultModelByType] User ${userId} has no BYOK ${modelType} model`,
        );
        return null;
      }

      // 2026-05-25 严格 BYOK 收口（用户政策「BYOK 不要到 admin，除非授权」）：
      //   无 userId（background cron / 系统任务）**不再回退 admin AIModel**。
      //   "授权" = 用户向系统申请的 ASSIGNED（KeyAssignment）路径，必须带 userId；
      //   无 userId = 无法授权 → 返回 null，让后台任务优雅失败/跳过，
      //   绝不静默用 admin key 烧平台的钱。需要后台跑 AI 的任务必须在带授权
      //   用户上下文（PERSONAL / ASSIGNED）下运行。
      this.logger.warn(
        `[getDefaultModelByType] No userId context for ${modelType} — strict BYOK: NOT falling back to admin. ` +
          `Background tasks must run under an authorized user (PERSONAL / ASSIGNED).`,
      );
      return null;
    } catch (error) {
      this.logger.error(`[getDefaultModelByType] Failed: ${error}`);
      return null;
    }
  }

  /**
   * ★ 2026-06-02 BYOK throttle resilience：取某用户某模型显式配置的速率上限。
   * 仅返回用户在 UserModelConfig 里**显式填过**的 rpmLimit/tpmLimit（null = 未配 = 不限流）。
   * 用于让"添加模型配置"里填的 RPM 真正生效（此前是死配置）。查询失败/无配 → null。
   */
  async getRateLimitForUserModel(
    userId: string,
    modelId: string,
  ): Promise<{ rpmLimit: number | null; tpmLimit: number | null } | null> {
    try {
      const cfg = await this.prisma.userModelConfig.findFirst({
        where: { userId, modelId, isEnabled: true },
        select: { rpmLimit: true, tpmLimit: true },
        orderBy: { updatedAt: "desc" },
      });
      return cfg ? { rpmLimit: cfg.rpmLimit, tpmLimit: cfg.tpmLimit } : null;
    } catch {
      return null;
    }
  }

  /**
   * 项目唯一 BYOK 选模型入口 —— 所有 AI 入口（chat / embedding / image / rerank...）
   * 都调这个，**不要在 service 里写自己的版本**。
   *
   * 顺序（全部在 BYOK 范围内）：
   *   1. UserModelConfig (PERSONAL BYOK)：用户自己配的，isDefault → priority → updatedAt 排序
   *   2. KeyAssignment (ASSIGNED)：用户向 admin 申请到的 AIModel，仍属 BYOK 范围
   *   都不命中 → null（caller 负责 throw 引导用户去 BYOK 配置页）
   *
   * 无 userId（background cron / health check）→ 走 admin AIModel 兜底（仅此一例）
   *
   * 返回原始 DB 行（UserModelConfig 或 AIModel），caller 按需构造自己的 ModelConfig
   * 形状（chat 用 AIModelConfig，embedding 用 EmbeddingModelConfig 等）。
   */
  async pickBYOKModelForUser(
    modelType: AIModelType,
    userIdOverride?: string,
  ): Promise<{
    source: "user-model-config" | "assigned" | "system";
    modelId: string;
    provider: string;
    apiEndpoint: string | null;
    apiFormat: string | null;
    embeddingDimensions: number | null;
    maxInputTokens: number | null;
    maxTokens: number;
    temperature: number;
    isReasoning: boolean;
    supportsTemperature: boolean;
    supportsStreaming: boolean;
    supportsFunctionCalling: boolean;
    supportsVision: boolean;
    tokenParamName: string;
    defaultTimeoutMs: number;
    /** 仅 source='system' 时填，指向 Secret Manager 中的 key 名 */
    secretKey: string | null;
    /** 每分钟请求数上限；null = caller 用 provider 启发式默认 */
    rpmLimit: number | null;
    /** 每分钟 token 上限；null = caller 用 provider 启发式默认 */
    tpmLimit: number | null;
  } | null> {
    const userId = userIdOverride ?? RequestContext.getUserId() ?? undefined;

    if (userId) {
      // 1. UserModelConfig — 用户 PERSONAL BYOK 的模型偏好
      const userConfig = await this.prisma.userModelConfig.findFirst({
        where: { userId, modelType, isEnabled: true },
        orderBy: [
          { isDefault: "desc" },
          { priority: "desc" },
          { updatedAt: "desc" },
        ],
      });
      if (userConfig) {
        return {
          source: "user-model-config",
          modelId: userConfig.modelId,
          provider: userConfig.provider,
          apiEndpoint: userConfig.apiEndpoint,
          apiFormat: userConfig.apiFormat,
          embeddingDimensions: userConfig.embeddingDimensions,
          maxInputTokens: userConfig.maxInputTokens,
          maxTokens: userConfig.maxTokens,
          temperature: userConfig.temperature,
          isReasoning: userConfig.isReasoning,
          supportsTemperature: userConfig.supportsTemperature,
          supportsStreaming: userConfig.supportsStreaming,
          supportsFunctionCalling: userConfig.supportsFunctionCalling,
          supportsVision: userConfig.supportsVision,
          tokenParamName: userConfig.tokenParamName,
          defaultTimeoutMs: userConfig.defaultTimeoutMs,
          secretKey: null,
          rpmLimit: userConfig.rpmLimit,
          tpmLimit: userConfig.tpmLimit,
        };
      }

      // 2. KeyAssignment（admin 授权 = 用户向 admin 申请的，仍属 BYOK 范围）
      const assigned = await this.prisma.keyAssignment.findMany({
        where: { userId, status: "ACTIVE" },
        select: { modelDbId: true },
        orderBy: { assignedAt: "desc" },
      });
      const assignedModelIds = assigned
        .map((a) => a.modelDbId)
        .filter((id): id is string => !!id);
      if (assignedModelIds.length > 0) {
        const m = await this.prisma.aIModel.findFirst({
          where: {
            id: { in: assignedModelIds },
            modelType,
            isEnabled: true,
          },
        });
        if (m) {
          return {
            source: "assigned",
            modelId: m.modelId,
            provider: m.provider,
            apiEndpoint: m.apiEndpoint,
            apiFormat: m.apiFormat,
            embeddingDimensions: m.embeddingDimensions,
            maxInputTokens: m.maxInputTokens,
            maxTokens: m.maxTokens,
            temperature: m.temperature,
            isReasoning: m.isReasoning,
            supportsTemperature: m.supportsTemperature,
            supportsStreaming: m.supportsStreaming,
            supportsFunctionCalling: m.supportsFunctionCalling,
            supportsVision: m.supportsVision,
            tokenParamName: m.tokenParamName,
            defaultTimeoutMs: m.defaultTimeoutMs,
            secretKey: m.secretKey,
            rpmLimit: m.rpmLimit,
            tpmLimit: m.tpmLimit,
          };
        }
      }

      // 严格 BYOK：用户上下文都不命中 → null，不回退 admin
      return null;
    }

    // 2026-05-25 严格 BYOK 收口（用户政策「BYOK 不要到 admin，除非授权」）：
    //   无 userId（background cron / 系统任务）**不再回退 admin AIModel**。
    //   授权走 ASSIGNED（KeyAssignment，需 userId）；无 userId 无法授权 → null。
    //   调用方（如 embedding.service）应在无 userId 时走自己的显式 env key 兜底，
    //   而不是静默用 admin DB 里配置的 provider key。
    this.logger.warn(
      `[pickBYOKModelForUser] No userId context for ${modelType} — strict BYOK: NOT falling back to admin.`,
    );
    return null;
  }

  /**
   * 获取所有启用的指定类型的模型
   * @param modelType 模型类型
   */
  async getAllEnabledModelsByType(
    modelType: AIModelType,
    excludeModelIds: string[] = [],
  ): Promise<AIModelConfig[]> {
    try {
      // ★ BYOK v3: 若当前请求上下文有 userId 且用户已配了 UserModelConfig
      // （对应 modelType，isEnabled），用用户自己的模型；否则回落到管理员全局模型
      // （但仅限"刚需"类型，见下方 BYOK_OPTIONAL_TYPES）。
      const userId = RequestContext.getUserId();
      if (userId) {
        try {
          // 先不带 excludeModelIds 查一次"用户是否有该 type 的任何 UserModelConfig"——
          // 区分「用户真的没配」vs「用户配了但都在本次 retry 的黑名单里」两种场景。
          const userHasAny = await this.prisma.userModelConfig.count({
            where: { userId, modelType, isEnabled: true },
          });

          const userRows = await this.prisma.userModelConfig.findMany({
            where: {
              userId,
              modelType,
              isEnabled: true,
              ...(excludeModelIds.length > 0 && {
                modelId: { notIn: excludeModelIds },
              }),
            },
            orderBy: [{ isDefault: "desc" }, { priority: "desc" }],
          });
          if (userRows.length > 0) {
            // FIX 2: Exclude image/audio/video models mis-tagged as a text modelType.
            const isTextQuery = TEXT_MODEL_TYPES.has(String(modelType));
            const filteredRows = isTextQuery
              ? userRows.filter((r) => {
                  if (isNonTextGenerationModelId(r.modelId)) {
                    this.logger.warn(
                      `[getAllEnabledModelsByType] Excluding non-text model "${r.modelId}" ` +
                        `from user ${userId} ${modelType} pool (mis-tagged modelType guard)`,
                    );
                    return false;
                  }
                  return true;
                })
              : userRows;
            if (filteredRows.length > 0) {
              this.logger.debug(
                `[getAllEnabledModelsByType] Using ${filteredRows.length} UserModelConfig rows for user=${userId}, type=${modelType}`,
              );
              return Promise.all(
                filteredRows.map((r) => this.toAIModelConfigFromUserConfig(r)),
              );
            }
          }

          // ★ 严格 BYOK 隔离：用户有 UserModelConfig 但都被排除（本次失败重试链耗尽）→
          // 返回空。**绝不回落 admin AIModel**，否则 admin key + admin modelId 会被偷用。
          if (userHasAny > 0) {
            this.logger.warn(
              `[getAllEnabledModelsByType] User ${userId} has ${userHasAny} UserModelConfig for ${modelType}, but all excluded by retry list. Strict BYOK: NOT falling back to admin.`,
            );
            return [];
          }
        } catch (error) {
          // 注意：加载用户配置失败也**不回退 admin**（严格 BYOK）。下方直接返回空。
          this.logger.warn(
            `[getAllEnabledModelsByType] Failed to load UserModelConfig for ${userId}: ${(error as Error).message}; returning empty (strict BYOK, NOT falling back to admin)`,
          );
        }

        // 2026-05-12 严格 BYOK：用户有 userId 但没配任何 UserModelConfig
        // → 返回空（**所有 modelType** 都严格）。上层 caller 应 throw 引导
        // 用户去 BYOK 配置页。**绝不**回落 admin AIModel——这是用户明确要求
        // 的政策。原 BYOK_OPTIONAL_TYPES 区分已废弃。
        this.logger.debug(
          `[getAllEnabledModelsByType] User ${userId} has no ${modelType} UserModelConfig — strict BYOK, returning empty`,
        );
        return [];
      }

      // 2026-05-25 严格 BYOK 收口（用户政策「BYOK 不要到 admin，除非授权」）：
      //   无 userId（background cron / health check / 系统任务）**不再回退
      //   admin AIModel**。返回空让调用方优雅失败/跳过，绝不静默烧 admin key。
      //   "授权" = 用户向系统申请的 ASSIGNED 路径（需 userId）。
      this.logger.warn(
        `[getAllEnabledModelsByType] No userId context for ${modelType} — strict BYOK: NOT falling back to admin, returning empty.`,
      );
      return [];
    } catch (error) {
      this.logger.error(`[getAllEnabledModelsByType] Failed: ${error}`);
      return [];
    }
  }

  /**
   * BYOK cross-model failover helper — explicit userId variant of
   * getAllEnabledModelsByType.
   *
   * Unlike getAllEnabledModelsByType (which reads userId from RequestContext),
   * this method accepts userId as a parameter so it can be called from async
   * closures that may not have a request context (e.g. model-failover callback
   * in LlmExecutor).  Returns the user's enabled models of the given modelType,
   * ordered by isDefault desc, priority desc, with excludeModelIds filtered out.
   * Strict BYOK: returns empty array if the user has no UserModelConfig for the
   * type (never falls back to admin AIModel rows).
   */
  async listUserEnabledModelsByType(
    userId: string,
    modelType: AIModelType,
    excludeModelIds: ReadonlyArray<string> = [],
    excludeProviders: ReadonlyArray<string> = [],
  ): Promise<AIModelConfig[]> {
    try {
      const rows = await this.prisma.userModelConfig.findMany({
        where: {
          userId,
          modelType,
          isEnabled: true,
          ...(excludeModelIds.length > 0 && {
            modelId: { notIn: [...excludeModelIds] },
          }),
          // failover：跳过已失败 provider 的全部模型（out of credits / no key）。
          ...(excludeProviders.length > 0 && {
            provider: {
              notIn: excludeProviders.map((p) => p.toLowerCase()),
            },
          }),
        },
        orderBy: [{ isDefault: "desc" }, { priority: "desc" }],
      });
      const configs = await Promise.all(
        rows.map((r) => this.toAIModelConfigFromUserConfig(r)),
      );
      // 防御：排除被误标为 CHAT 的图像生成模型（如 grok-imagine-image）——它们
      // 不能对话，不应进入 CHAT failover 候选。按 modelId 命名启发式识别。
      // IMAGE 类型查询本身不过滤（那里图像模型才是合法目标）。
      return String(modelType) === "IMAGE"
        ? configs
        : configs.filter((c) => !IMAGE_MODEL_ID_PATTERN.test(c.modelId));
    } catch (error) {
      this.logger.warn(
        `[listUserEnabledModelsByType] Failed for user=${userId} type=${modelType}: ${(error as Error).message}`,
      );
      return [];
    }
  }

  /**
   * 获取推理模型配置
   * 优先返回数据库配置的推理模型，否则根据名称推断
   */
  async getReasoningModelConfig(): Promise<AIModelConfig | null> {
    try {
      // ★ 1. 优先查找数据库中标记为推理模型的配置
      const reasoningModel = await this.prisma.aIModel.findFirst({
        where: {
          modelType: "CHAT",
          isEnabled: true,
          isReasoning: true, // ★ 依赖数据库配置
        },
        orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      });

      if (reasoningModel) {
        this.logger.debug(
          `[getReasoningModelConfig] Found reasoning model from DB: ${reasoningModel.modelId}`,
        );
        return this.buildModelConfig(reasoningModel);
      }

      // ★ 2. 回退：根据已知模型名称推断
      const knownReasoningModels = await this.prisma.aIModel.findMany({
        where: {
          modelType: "CHAT",
          isEnabled: true,
          OR: [
            { modelId: { contains: "o1", mode: "insensitive" } },
            { modelId: { contains: "o3", mode: "insensitive" } },
            { modelId: { contains: "gpt-5", mode: "insensitive" } },
            {
              modelId: {
                contains: "gemini-2.0-flash-thinking",
                mode: "insensitive",
              },
            },
            { modelId: { contains: "deepseek-r1", mode: "insensitive" } },
            { modelId: { contains: "reasoning", mode: "insensitive" } },
          ],
        },
        orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      });

      if (knownReasoningModels.length > 0) {
        const model = knownReasoningModels[0];
        this.logger.debug(
          `[getReasoningModelConfig] Found reasoning model by name: ${model.modelId}`,
        );
        return this.buildModelConfig(model);
      }

      this.logger.warn(`[getReasoningModelConfig] No reasoning model found`);
      return null;
    } catch (error) {
      this.logger.error(`[getReasoningModelConfig] Failed: ${error}`);
      return null;
    }
  }

  /**
   * 获取 provider 的 API 格式
   */
  getApiFormatForProvider(provider: string): string {
    return this.inferApiFormat(provider);
  }

  // ==================== 统一模型查询方法 ====================
  // ★ 以下方法是数据库访问的唯一入口，其他服务应该委托给这里

  /**
   * 获取所有启用的模型列表（用于前端下拉列表）
   * ★ 不包含 API Key，安全返回给前端
   */
  async getEnabledModelsForFrontend(
    modelType?: AIModelType,
    userId?: string,
  ): Promise<
    {
      id: string;
      dbId: string;
      name: string;
      modelName: string;
      provider: string;
      modelId: string;
      modelType: string;
      icon: string | null;
      iconUrl: string;
      color: string | null;
      description: string;
      isDefault: boolean;
      isUserKey?: boolean;
    }[]
  > {
    try {
      this.logger.debug(
        `[getEnabledModelsForFrontend] Called with userId=${userId || "NONE"}, modelType=${modelType || "ALL"}`,
      );

      const where: Record<string, unknown> = { isEnabled: true };
      if (modelType) {
        where.modelType = modelType;
      }

      const modelSelect = {
        id: true,
        name: true,
        displayName: true,
        provider: true,
        modelId: true,
        modelType: true,
        icon: true,
        color: true,
        description: true,
        isDefault: true,
      };

      const models = await this.prisma.aIModel.findMany({
        where,
        orderBy: [{ isDefault: "desc" }, { name: "asc" }],
        select: modelSelect,
      });

      // Ensure models is always an array
      if (!models || !Array.isArray(models)) {
        this.logger.warn(
          `[getEnabledModelsForFrontend] Prisma returned non-array: ${typeof models}`,
        );
        return [];
      }

      // Check user API keys if userId is provided
      // 同时查 PERSONAL（user_api_keys）+ ASSIGNED（key_assignments）。
      // 2026-05-08 v5：KeyAssignment 直接关联 AIModel，不再走 DistributableKey 池。
      // 仍保留 PERSONAL+ASSIGNED union 用于显示用户能用哪些 provider 的模型。
      //
      // 设计前提：admin 只对 isEnabled=true 的模型授权（grantBatch 已拒绝 disabled），
      //   而 admin 关掉某模型时 byok-maintenance.scheduler 会把对应 assignment 转 STALE。
      //   因此 ACTIVE assignment 永远对应 isEnabled=true 的 AIModel — 第一段 `models`
      //   查询足以覆盖全部应该可见的模型。
      // 2026-05-10 §1 v3 — "My Key" 严格语义修正：
      //   - assignedModelIds：用户被 admin 专门授权（ACTIVE KeyAssignment）的具体
      //     AIModel.id Set。这是"我的 key"在 admin 侧的唯一合法依据。
      //   - userProviders：仅供向后兼容 / debug log；mapModel 不再用它判 isUserKey。
      //
      // 旧逻辑（错）：admin enabled AIModel + user 有该 provider PERSONAL key →
      //   isUserKey=true。但 PERSONAL key 不等于"被授权使用这个具体 model"，
      //   admin 模型对该用户应该是"系统 Key"标识，除非有 KeyAssignment。
      let userProviders = new Set<string>();
      let assignedModelIds = new Set<string>();
      if (userId) {
        try {
          const [personalKeys, assignedKeys] = await Promise.all([
            this.prisma.userApiKey.findMany({
              where: { userId, isActive: true },
              select: { provider: true },
            }),
            this.prisma.keyAssignment.findMany({
              where: { userId, status: "ACTIVE" },
              select: { provider: true, modelDbId: true },
            }),
          ]);
          userProviders = new Set([
            ...personalKeys.map((k) => k.provider.toLowerCase()),
            ...assignedKeys.map((k) => k.provider.toLowerCase()),
          ]);
          assignedModelIds = new Set(assignedKeys.map((k) => k.modelDbId));
          this.logger.debug(
            `[getEnabledModelsForFrontend] User ${userId} has keys for providers: ` +
              `[${[...userProviders].join(", ")}] ` +
              `(personal=${personalKeys.length}, assigned=${assignedKeys.length}, ` +
              `assignedModelIds=${assignedModelIds.size})`,
          );
        } catch (error) {
          this.logger.warn(
            `[getEnabledModelsForFrontend] Failed to fetch user API keys: ${error}`,
          );
        }
      }

      // 用户自定义的 UserModelConfig（personal BYOK v3）：用户在「我的模型」tab 自配的模型，
      // 跑在自己的 UserApiKey 上。AIModel 是 admin 维护的全局池，UserModelConfig 是 user 级的，
      // 互不干扰；但业务下拉里两者都该出现。
      // 设计：以 (provider, modelId) 为身份去重 — admin 的 AIModel 同 (provider, modelId) 优先；
      //       UserModelConfig 仅补"AIModel 没有"的条目。
      let userPersonalConfigs: Array<{
        id: string;
        modelId: string;
        displayName: string;
        provider: string;
        modelType: string;
        isDefault: boolean;
      }> = [];
      if (userId) {
        try {
          const personalWhere: Record<string, unknown> = {
            userId,
            isEnabled: true,
          };
          if (modelType) {
            personalWhere.modelType = modelType;
          }
          userPersonalConfigs = await this.prisma.userModelConfig.findMany({
            where: personalWhere,
            select: {
              id: true,
              modelId: true,
              displayName: true,
              provider: true,
              modelType: true,
              isDefault: true,
            },
            orderBy: [{ isDefault: "desc" }, { displayName: "asc" }],
          });
          this.logger.debug(
            `[getEnabledModelsForFrontend] User ${userId} has ${userPersonalConfigs.length} personal UserModelConfig entries`,
          );
        } catch (error) {
          this.logger.warn(
            `[getEnabledModelsForFrontend] Failed to fetch UserModelConfig: ${error}`,
          );
        }
      }

      // 2026-05-10 §1 v2：删除 userExtraModels（disabled AIModel + provider key
      // 自动捞回）路径。
      //
      // 旧逻辑：admin 关掉某 AIModel 后，只要 user 有对应 provider 的
      // KeyAssignment / UserApiKey，仍把 disabled 行拉回 dropdown 标 isUserKey=true。
      // 设计意图："admin 不付费，user 自付"。
      //
      // 实战问题（用户多次反馈"我没有 R1，为啥还显示"）：用户在 BYOK"我的模型" UI
      // 看不到 disabled AIModel 行（那个 UI 列 UserModelConfig + KeyAssignment），
      // 但 AI Ask 下拉里凭空冒出 → 三处不一致 → 困惑 + 选中后运行时 401（admin
      // 已禁用）。
      //
      // 现行（双源根治 v2）：dropdown 只信任两条真源
      //   1. AIModel where isEnabled=true（admin 主动启用）
      //   2. UserModelConfig where user 显式添加（"我的模型"页面手动 / 获取按钮）
      // disabled AIModel 真消失。需要"自付"模式的用户走 UserModelConfig 自配。
      const userExtraModels: typeof models = [];

      const mapModel = (model: (typeof models)[0], isUserKey: boolean) => ({
        id: model.id,
        dbId: model.id,
        name: model.displayName,
        modelName: model.name,
        provider: model.provider,
        modelId: model.modelId,
        modelType: model.modelType,
        icon: model.icon,
        iconUrl: this.getIconUrl(model.name, model.provider),
        color: model.color,
        description:
          model.description || `${model.provider} ${model.displayName}`,
        isDefault: model.isDefault,
        ...(isUserKey ? { isUserKey: true } : {}),
      });

      // (provider, modelId) 已被 admin AIModel 或 userExtraModels 覆盖的，不再重复添加 UserModelConfig
      const existingProviderModelKeys = new Set([
        ...models.map(
          (m) => `${m.provider.toLowerCase()}::${m.modelId.toLowerCase()}`,
        ),
        ...userExtraModels.map(
          (m) => `${m.provider.toLowerCase()}::${m.modelId.toLowerCase()}`,
        ),
      ]);
      const userPersonalUnique = userPersonalConfigs.filter(
        (c) =>
          !existingProviderModelKeys.has(
            `${c.provider.toLowerCase()}::${c.modelId.toLowerCase()}`,
          ),
      );

      const mapPersonalConfig = (c: (typeof userPersonalConfigs)[0]) => ({
        id: c.id,
        dbId: c.id,
        name: c.displayName,
        modelName: c.modelId,
        provider: c.provider,
        modelId: c.modelId,
        modelType: c.modelType,
        icon: null,
        iconUrl: this.getIconUrl(c.modelId, c.provider),
        color: null,
        description: `${c.provider} ${c.displayName} (你的 BYOK 配置)`,
        isDefault: c.isDefault,
        isUserKey: true, // UserModelConfig 跑在用户自己 Key 上
      });

      // 2026-05-10 §1 v3：admin AIModel 的 isUserKey 现仅由 ACTIVE KeyAssignment
      // 指向**这个具体 model.id** 决定，不再用 provider 匹配（provider PERSONAL
      // key 不等于"被授权使用这个 admin model"）。
      const result = [
        ...models.map((m) => mapModel(m, assignedModelIds.has(m.id))),
        ...userExtraModels.map((m) => mapModel(m, true)),
        ...userPersonalUnique.map(mapPersonalConfig),
      ];

      if (userId) {
        const userKeyModels = result.filter((m) => m.isUserKey);
        this.logger.debug(
          `[getEnabledModelsForFrontend] Returning ${result.length} models, ${userKeyModels.length} with isUserKey: [${userKeyModels.map((m) => m.name).join(", ")}]`,
        );
      }

      return result;
    } catch (error) {
      this.logger.error(`[getEnabledModelsForFrontend] Failed: ${error}`);
      // Always return an empty array, never null/undefined
      return [];
    }
  }

  /**
   * 根据模型名称获取图标 URL
   */
  private getIconUrl(name: string, provider?: string): string {
    const lowerName = name.toLowerCase();
    const lowerProvider = (provider || "").toLowerCase();

    if (lowerName.includes("grok") || lowerProvider === "xai") {
      return "/icons/ai/grok.svg";
    }
    if (
      lowerName.includes("gpt") ||
      lowerName.includes("chatgpt") ||
      lowerProvider === "openai"
    ) {
      return "/icons/ai/openai.svg";
    }
    if (lowerName.includes("claude") || lowerProvider === "anthropic") {
      return "/icons/ai/claude.svg";
    }
    if (lowerName.includes("gemini") || lowerProvider === "google") {
      return "/icons/ai/gemini.svg";
    }
    if (
      lowerName.includes("doubao") ||
      lowerName.includes("豆包") ||
      lowerProvider === "bytedance"
    ) {
      return "/icons/ai/doubao.svg";
    }
    if (lowerName.includes("deepseek") || lowerProvider === "deepseek") {
      return "/icons/ai/deepseek.svg";
    }
    if (
      lowerName.includes("qwen") ||
      lowerName.includes("通义") ||
      lowerProvider === "alibaba"
    ) {
      return "/icons/ai/qwen.svg";
    }
    if (lowerName.includes("kimi") || lowerProvider === "moonshot") {
      return "/icons/ai/kimi.svg";
    }
    if (lowerName.includes("glm") || lowerProvider === "zhipu") {
      return "/icons/ai/zhipu.svg";
    }
    // 无法识别时不返回错误图标，让前端 PROVIDER_ICONS fallback 处理
    return "";
  }

  /**
   * 根据 ID（数据库 UUID 或 modelId）查找模型
   * ★ 统一入口，支持多种 ID 格式
   * ★ 支持所有 modelType（包括 IMAGE_GENERATION、EMBEDDING 等）
   */
  async getModelById(idOrModelId: string): Promise<AIModelConfig | null> {
    // ★ BYOK 解析缓存：命中即跳过整条串行 DB fallback 链（见字段注释）。
    //   key 含 userId —— BYOK 配置按用户隔离；无 userId 的后台调用归入 "system"。
    const t0 = Date.now();
    const userId = RequestContext.getUserId();
    const cacheKey = `${userId ?? "system"}::${idOrModelId}`;
    const cached = this.resolvedModelCache.get(cacheKey);
    if (cached && Date.now() - cached.time < this.RESOLVED_MODEL_CACHE_TTL) {
      this.recordResolveSegment(
        t0,
        idOrModelId,
        cached.config,
        "cached",
        false,
      );
      return cached.config;
    }
    const resolved = await this.resolveModelByIdUncached(idOrModelId);
    this.resolvedModelCache.set(cacheKey, {
      config: resolved,
      time: Date.now(),
    });
    this.recordResolveSegment(
      t0,
      idOrModelId,
      resolved,
      this.classifyResolveSource(resolved),
      true,
    );
    return resolved;
  }

  /**
   * 把本次模型解析记成请求级时延明细（底层、全模块通用）。source/cold 让"冷解析率"
   * 和"解析延迟"成为可观测指标 —— 这是 #215/#223/#227 优化的 KPI，原先只在日志里。
   * 无活跃请求上下文时（后台任务）RequestContext 静默 no-op。
   */
  private recordResolveSegment(
    startedAt: number,
    requestedId: string,
    config: AIModelConfig | null,
    source: "cached" | "registered" | "synthesized",
    cold: boolean,
  ): void {
    RequestContext.pushLatencySegment({
      kind: "model_resolve",
      name: requestedId,
      ms: Date.now() - startedAt,
      meta: {
        source,
        cold,
        hit: config != null,
        model: config?.modelId,
        provider: config?.provider,
      },
    });
  }

  /**
   * 按 resolved config 的 id 形态判定来源：合成 vs 注册。
   * synthesizeConfigForUserModel 的 id = `user-${userId}-${provider}-${modelId}`；
   * UserModelConfig = `user-model-config-${id}`；admin AIModel = DB uuid。
   */
  private classifyResolveSource(
    config: AIModelConfig | null,
  ): "registered" | "synthesized" {
    const id = config?.id ?? "";
    return id.startsWith("user-") && !id.startsWith("user-model-config-")
      ? "synthesized"
      : "registered";
  }

  /**
   * 清除 BYOK 解析缓存。用户改 Key / 模型配置后应调用（传 userId 只清该用户）。
   * 不传 userId = 全清（如管理员批量改模型）。
   */
  clearResolvedModelCache(userId?: string): void {
    if (!userId) {
      this.resolvedModelCache.clear();
      return;
    }
    const prefix = `${userId}::`;
    for (const key of [...this.resolvedModelCache.keys()]) {
      if (key.startsWith(prefix)) {
        this.resolvedModelCache.delete(key);
      }
    }
  }

  private async resolveModelByIdUncached(
    idOrModelId: string,
  ): Promise<AIModelConfig | null> {
    // 1. 先尝试按 modelId/name 查找（使用缓存，仅 CHAT/CHAT_FAST）
    const configByModelId = await this.getModelConfig(idOrModelId);
    if (configByModelId) {
      return configByModelId;
    }

    // 2. 按数据库 ID 查找（AIModel UUID 36 字符 OR UserModelConfig CUID 25 字符）
    //
    // 2026-05-10：把阈值从 >30 降到 >20，覆盖 CUID（dropdown 选 UserModelConfig
    // 时前端传的就是 CUID，不是 modelId 字符串）。之前 CUID < 30 直接跳过这步，
    // 又因 UserModelConfig 没在 step 1/3/4 任何路径按 id 查，导致 lookup 全 miss
    // → fallback default → 0 enabled AIModel → "No CHAT AI model is available"。
    if (idOrModelId.length > 20) {
      try {
        const model = await this.prisma.aIModel.findFirst({
          where: {
            id: idOrModelId,
            isEnabled: true,
          },
        });
        if (model) {
          return this.buildModelConfig(model);
        }
      } catch (error) {
        this.logger.warn(`[getModelById] Database query failed: ${error}`);
      }

      // ★ BYOK v3 (2026-05-10)：UserModelConfig 也按 id 查（dropdown 传 CUID 走这条）
      const userId = RequestContext.getUserId();
      if (userId && this.userModelConfigs) {
        try {
          const userCfg = await this.prisma.userModelConfig.findFirst({
            where: { id: idOrModelId, userId, isEnabled: true },
          });
          if (userCfg) {
            return this.toAIModelConfigFromUserConfig(userCfg);
          }
        } catch (error) {
          this.logger.warn(
            `[getModelById] UserModelConfig query failed: ${error}`,
          );
        }
      }
    }

    // 3. ★ 直接按 modelId/name 查找所有类型的模型（包括 IMAGE_GENERATION、EMBEDDING 等）
    //    这是为了支持非 CHAT 类型模型的查找
    try {
      const model = await this.prisma.aIModel.findFirst({
        where: {
          OR: [
            { modelId: { equals: idOrModelId, mode: "insensitive" } },
            { name: { equals: idOrModelId, mode: "insensitive" } },
          ],
          isEnabled: true,
        },
      });
      if (model) {
        this.logger.debug(
          `[getModelById] Found model ${model.modelId} (type: ${model.modelType}) via direct query`,
        );
        return this.buildModelConfig(model);
      }
    } catch (error) {
      this.logger.warn(`[getModelById] Direct modelId query failed: ${error}`);
    }

    // 4. ★ BYOK: 查找 disabled 模型（用户有对应 provider 的 Key 时可用）
    const disabledConfig = await this.findDisabledModelForUser(idOrModelId);
    if (disabledConfig) return disabledConfig;

    return null;
  }

  /**
   * ★ BYOK: 查找 disabled 模型，验证用户有对应 provider 的 active key
   * 不污染公共缓存，disabled 模型走独立查询
   */
  private async findDisabledModelForUser(
    idOrModelId: string,
    modelTypes?: string[],
  ): Promise<AIModelConfig | null> {
    const userId = RequestContext.getUserId();
    if (!userId) return null;

    try {
      const orClauses: Array<Record<string, unknown>> = [
        { modelId: { equals: idOrModelId, mode: "insensitive" } },
        { name: { equals: idOrModelId, mode: "insensitive" } },
      ];
      // Also try UUID match
      if (idOrModelId.length > 30) {
        orClauses.push({ id: idOrModelId });
      }
      const where: Record<string, unknown> = {
        OR: orClauses,
        isEnabled: false,
      };
      if (modelTypes) {
        where.modelType = { in: modelTypes };
      }

      const model = await this.prisma.aIModel.findFirst({ where });
      if (!model) return null;

      // Verify user has an active key for this provider
      const hasKey = await this.userApiKeysService.getPersonalKey(
        userId,
        model.provider.toLowerCase(),
      );
      if (!hasKey) return null;

      this.logger.debug(
        `[BYOK] Found disabled model ${model.modelId} for user ${userId} (has ${model.provider} key)`,
      );
      return this.buildModelConfig(model);
    } catch (error) {
      this.logger.warn(`[findDisabledModelForUser] Failed: ${error}`);
      return null;
    }
  }

  /**
   * 获取指定 provider 的模型列表
   */
  async getModelsByProvider(providerName: string): Promise<AIModelConfig[]> {
    const models = await this.prisma.aIModel.findMany({
      where: {
        isEnabled: true,
        OR: [
          { provider: { contains: providerName, mode: "insensitive" } },
          { modelId: { contains: providerName, mode: "insensitive" } },
        ],
      },
    });
    return models.map((m) => this.buildModelConfig(m));
  }

  /**
   * 获取第一个可用的指定 provider 模型（带完整配置）
   */
  async getFirstModelByProvider(
    providerName: string,
  ): Promise<AIModelConfig | null> {
    const model = await this.prisma.aIModel.findFirst({
      where: {
        isEnabled: true,
        OR: [
          { provider: { contains: providerName, mode: "insensitive" } },
          { modelId: { contains: providerName, mode: "insensitive" } },
        ],
        apiKey: { not: null },
      },
    });
    return model ? this.buildModelConfig(model) : null;
  }

  /**
   * 获取所有模型（诊断用，包含 API Key 信息）
   * ⚠️ 仅用于内部诊断，不要暴露给前端
   */
  async getAllModelsForDiagnostics(): Promise<
    {
      id: string;
      name: string;
      modelId: string;
      provider: string;
      modelType: string;
      isEnabled: boolean;
      isDefault: boolean;
      hasApiKey: boolean;
      hasSecretKey: boolean;
      apiEndpoint: string | null;
    }[]
  > {
    const models = await this.prisma.aIModel.findMany({
      select: {
        id: true,
        name: true,
        modelId: true,
        provider: true,
        modelType: true,
        isEnabled: true,
        isDefault: true,
        apiKey: true,
        secretKey: true,
        apiEndpoint: true,
      },
    });

    return models.map((m) => ({
      id: m.id,
      name: m.name,
      modelId: m.modelId,
      provider: m.provider,
      modelType: m.modelType,
      isEnabled: m.isEnabled,
      isDefault: m.isDefault,
      hasApiKey: !!m.apiKey,
      hasSecretKey: !!m.secretKey,
      apiEndpoint: m.apiEndpoint,
    }));
  }

  /**
   * 计算模型的超时时间
   * 推理模型需要更长的超时时间
   */
  getTimeoutForModel(modelId: string, maxTokens: number): number {
    // ★ 使用统一的 isReasoningModel() 方法，优先使用数据库配置
    const isReasoning = this.isReasoningModel(modelId);

    // 推理模型：5分钟起，最多15分钟
    // 普通模型：2分钟起，最多10分钟
    const baseTimeout = isReasoning ? 300000 : 120000;
    const maxTimeout = isReasoning ? 900000 : 600000;

    const dynamicTimeout = Math.max(
      baseTimeout,
      Math.min(maxTimeout, baseTimeout + Math.ceil(maxTokens / 1000) * 15000),
    );

    this.logger.debug(
      `[getTimeoutForModel] ${modelId}: ${dynamicTimeout}ms (maxTokens=${maxTokens}, reasoning=${isReasoning})`,
    );

    return dynamicTimeout;
  }
}
