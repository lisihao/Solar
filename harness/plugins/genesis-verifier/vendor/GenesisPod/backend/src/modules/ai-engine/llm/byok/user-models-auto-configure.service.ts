import { ConflictException, Injectable, Logger } from "@nestjs/common";
import { AIModelType, UserModelConfig } from "@prisma/client";
import { EventEmitter } from "events";

// auto-configure 的 probe 循环对单一 provider 会并发开多个 TLS 连接到 api.openai.com，
// Node 默认 10 个 listener 上限会触发 MaxListenersExceededWarning。
// 提升到 30 覆盖常规并发；真正泄漏在 30 以上仍会告警。
if (EventEmitter.defaultMaxListeners < 30) {
  EventEmitter.defaultMaxListeners = 30;
}
import { UserApiKeysService } from "../../../platform/credentials/user-owned/user-api-keys/user-api-keys.service";
import { UserModelConfigsService } from "../../../platform/credentials/user-owned/user-model-configs/user-model-configs.service";
import { AiModelDiscoveryService } from "../models/catalog/ai-model-discovery.service";
import { AiConnectionTestService } from "./ai-connection-test.service";
import { ModelRecommendationsService } from "../models/selection/model-recommendations.service";
import {
  EXCLUDED_MODEL_SUBSTRINGS,
  PROVIDER_PREFERENCE_BY_TYPE,
} from "../models/selection/default-recommendations.config";

export interface AutoConfigureResult {
  createdCount: number;
  skippedCount: number;
  items: Array<{
    provider: string;
    modelType: AIModelType;
    modelId: string;
    action: "created" | "skipped" | "skipped-provider-no-match";
    reason?: string;
  }>;
  missingTypes: AIModelType[];
}

type PersonalUserApiKey = Awaited<
  ReturnType<UserApiKeysService["listUserApiKeys"]>
>[number];

type ProviderRecommendation = Awaited<
  ReturnType<ModelRecommendationsService["getForProvider"]>
>[number];

/**
 * 用户版一键 AI 配置（重构版）：
 * - 遍历 modelType 维度，不再遍历 provider
 * - 每个 modelType 按 `PROVIDER_PREFERENCE_BY_TYPE` 顺序找"用户有 Key + /v1/models 命中"的首个 provider
 * - 命中即停，**每个 modelType 只建一个默认行**——避免中等 provider 污染列表
 * - 已有同 (provider, modelId, modelType) 的行跳过
 * - 已有 default 的 modelType 不再创建第二条（尊重用户手工设置）
 */
@Injectable()
export class AutoConfigureService {
  private readonly logger = new Logger(AutoConfigureService.name);

  constructor(
    private readonly userApiKeys: UserApiKeysService,
    private readonly modelDiscovery: AiModelDiscoveryService,
    private readonly userModelConfigs: UserModelConfigsService,
    private readonly recommendations: ModelRecommendationsService,
    private readonly connectionTest: AiConnectionTestService,
  ) {}

  async runForUser(userId: string): Promise<AutoConfigureResult> {
    const personalKeys = await this.userApiKeys.listUserApiKeys(userId);
    const activePersonal = personalKeys.filter(
      (key): key is PersonalUserApiKey =>
        key.isActive && key.mode === "personal",
    );

    if (activePersonal.length === 0) {
      return {
        createdCount: 0,
        skippedCount: 0,
        items: [],
        missingTypes: [AIModelType.CHAT, AIModelType.EMBEDDING],
      };
    }

    const result: AutoConfigureResult = {
      createdCount: 0,
      skippedCount: 0,
      items: [],
      missingTypes: [],
    };

    // provider → apiKey 映射（用户保存的 Personal Key），用于按偏好顺序查找
    const providerKeyMap = new Map<string, string>();
    // ★ 2026-06-11 修"一键配置的模型 BYOK 密钥未关联"：同时记 provider → keyId，
    //   create 时写入 apiKeyId，让模型显式 pin 到这把已验证的 Key（编辑弹窗回显、
    //   运行时 keyResolver(preferredKeyId) 都依赖它）。缺省 null 时虽能按 provider
    //   兜底解析，但多 Key 同 provider 会不确定，且 UI 显示"未关联"。
    const providerKeyIdMap = new Map<string, string>();
    for (const key of activePersonal) {
      const provider = key.provider.toLowerCase();
      if (!providerKeyIdMap.has(provider))
        providerKeyIdMap.set(provider, key.id);
      if (providerKeyMap.has(provider)) continue;
      const personal = await this.userApiKeys.getPersonalKey(userId, provider);
      if (personal?.apiKey) providerKeyMap.set(provider, personal.apiKey);
    }

    // 已有配置（用于去重 + 尊重用户现有默认）
    const existing = await this.userModelConfigs.listByUser(userId);
    const existingKeys = new Set(
      existing.map(
        (config) =>
          `${config.provider}:${config.modelId.toLowerCase()}:${config.modelType}`,
      ),
    );
    const defaultedTypes = new Set<AIModelType>();
    existing
      .filter((config) => config.isEnabled && config.isDefault)
      .forEach((config) => defaultedTypes.add(config.modelType));

    // 一个 provider 一个 modelType 只调一次 /v1/models，缓存复用
    const discoveryCache = new Map<string, string[] | null>();

    // ★ 核心循环：modelType 维度
    for (const [modelTypeStr, preferredProviders] of Object.entries(
      PROVIDER_PREFERENCE_BY_TYPE as Record<string, string[]>,
    )) {
      const modelType = modelTypeStr as AIModelType;

      // 已有默认就跳过（不污染，不强抢）
      if (defaultedTypes.has(modelType)) continue;

      let created = false;

      for (const provider of preferredProviders) {
        if (created) break;

        const apiKey = providerKeyMap.get(provider);
        if (!apiKey) continue; // 用户没配这个 provider 的 Key

        // 拉可用模型（per-type 过滤，如 EMBEDDING 只返回 embedding 模型）
        const availableIds = await this.getAvailableIds(
          provider,
          apiKey,
          modelType,
          discoveryCache,
        );
        if (!availableIds || availableIds.length === 0) continue;

        // 取 recommendation（DB 优先、默认 fallback、别名兜底）
        const providerRecs =
          await this.recommendations.getForProvider(provider);
        const rec = providerRecs.find(
          (recommendation: ProviderRecommendation) =>
            recommendation.modelType === modelType,
        );
        if (!rec || rec.patterns.length === 0) continue;

        // ★ 变成**可验证的迭代**：按 pattern 匹配的顺序取出所有候选 modelId，
        // 依次用最小 prompt 实际探测 chat 是否通；第一个通过的才写入。
        // 避免把"OpenAI 列表返回但 chat 无权限"的模型（如用户 key 权限不全的
        // gpt-4o-2024-11-20）写进去导致后续 Topic Insights 疯狂撞失败。
        const candidates = this.allMatches(availableIds, rec.patterns);
        if (candidates.length === 0) continue;

        let matchedId: string | undefined;
        for (const cand of candidates) {
          const probe = await this.probeModelUsable(
            provider,
            cand,
            apiKey,
            modelType,
          );
          if (probe.ok) {
            matchedId = cand;
            break;
          }
          this.logger.debug(
            `[user-auto-configure] Probe skip ${provider}/${cand}/${modelType}: ${probe.reason}`,
          );
        }
        if (!matchedId) {
          this.logger.warn(
            `[user-auto-configure] All candidates failed probe for ${provider}/${modelType}: ${candidates.join(", ")}`,
          );
          continue;
        }

        const dedupKey = `${provider}:${matchedId.toLowerCase()}:${modelType}`;
        if (existingKeys.has(dedupKey)) {
          // 已有但没 default——提升为 default
          const existingRow = this.findExistingConfig(
            existing,
            provider,
            matchedId,
            modelType,
          );
          if (existingRow && !existingRow.isDefault) {
            try {
              await this.userModelConfigs.update(userId, existingRow.id, {
                isDefault: true,
              });
              defaultedTypes.add(modelType);
              result.items.push({
                provider,
                modelType,
                modelId: matchedId,
                action: "skipped",
                reason: "Already exists — promoted to default",
              });
              created = true;
              continue;
            } catch (error) {
              this.logger.warn(
                `[user-auto-configure] Failed to promote ${provider}/${matchedId}/${modelType} to default: ${(error as Error).message}`,
              );
            }
          }
          result.skippedCount++;
          result.items.push({
            provider,
            modelType,
            modelId: matchedId,
            action: "skipped",
            reason: "Already configured",
          });
          // 即使已存在，也算 modelType 已覆盖，不要再尝试其他 provider
          created = true;
          continue;
        }

        try {
          await this.userModelConfigs.create(userId, {
            provider,
            modelId: matchedId,
            displayName: this.buildDisplayName(provider, matchedId, modelType),
            modelType,
            isDefault: true, // 每个 modelType 只建一个，直接设为默认
            // ★ 2026-06-11：显式关联探测时用的那把 BYOK Key（修"密钥未关联"）。
            apiKeyId: providerKeyIdMap.get(provider),
            maxTokens: this.inferMaxTokens(matchedId, modelType),
            ...this.inferCapabilities(matchedId, modelType, provider),
          });
          existingKeys.add(dedupKey);
          defaultedTypes.add(modelType);
          result.createdCount++;
          result.items.push({
            provider,
            modelType,
            modelId: matchedId,
            action: "created",
          });
          created = true;
        } catch (error) {
          // 双击 auto-configure 导致的并发写入——下层抛 ConflictException (P2002)。
          // 不是 bug，静默跳过即可；用户看到的是 createdCount 不涨、skippedCount 涨。
          const isDuplicate = error instanceof ConflictException;
          if (!isDuplicate) {
            this.logger.warn(
              `[user-auto-configure] Failed to create ${provider}/${matchedId}/${modelType}: ${(error as Error).message}`,
            );
          }
          existingKeys.add(dedupKey);
          defaultedTypes.add(modelType);
          result.skippedCount++;
          result.items.push({
            provider,
            modelType,
            modelId: matchedId,
            action: "skipped",
            reason: isDuplicate
              ? "Already configured"
              : (error as Error).message,
          });
          if (isDuplicate) created = true;
        }
      }
    }

    const requiredTypes: AIModelType[] = [
      AIModelType.CHAT,
      AIModelType.EMBEDDING,
    ];
    result.missingTypes = requiredTypes.filter((t) => !defaultedTypes.has(t));

    return result;
  }

  /**
   * 拉 provider 某个 modelType 的可用模型列表（缓存 + specialty 黑名单过滤）。
   */
  private async getAvailableIds(
    provider: string,
    apiKey: string,
    modelType: AIModelType,
    cache: Map<string, string[] | null>,
  ): Promise<string[] | null> {
    const cacheKey = `${provider}:${modelType}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey)!;

    const discovery = await this.modelDiscovery
      .fetchAvailableModels(provider, apiKey, undefined, modelType)
      .catch((error: Error) => {
        this.logger.warn(
          `[user-auto-configure] fetchAvailableModels(${provider}, ${modelType}) failed: ${error.message}`,
        );
        return { success: false, error: error.message };
      });

    if (!discovery.success || !("models" in discovery) || !discovery.models) {
      cache.set(cacheKey, null);
      return null;
    }

    // Image 类型保留所有（gpt-image-1 合法但 includes("-image-")）
    const isImageType =
      modelType === AIModelType.IMAGE_GENERATION ||
      modelType === AIModelType.IMAGE_EDITING;

    const filtered = discovery.models
      .map((model: { id: string }) => model.id)
      .filter((id: string) => {
        if (isImageType) return true;
        const lower = id.toLowerCase();
        return !EXCLUDED_MODEL_SUBSTRINGS.some((s: string) =>
          lower.includes(s),
        );
      });

    cache.set(cacheKey, filtered);
    return filtered;
  }

  /**
   * 从 availableIds 里挑符合 pattern 的 modelId。
   *
   * ★ 外层走 availableIds（discovery 已 newest-first 排序），内层走 patterns。
   *   **第一个能命中任何 pattern 的 id 就是最新代**——pattern 顺序不决定胜负，
   *   discovery 的 sortByRecencyDesc（created / 版本号）决定。
   *
   * 好处：
   *   - 添加新代际模型（如 gpt-6）不用改 pattern 顺序，只要 pattern 能涵盖它，
   *     且 provider 的 /v1/models 把它返回了，就自动胜出。
   *   - 避免 pattern 列表追模型发布节奏的问题。
   */
  /**
   * 返回 availableIds 里**所有**命中 patterns 的 modelId，保持传入顺序。
   * discovery 层（AiModelDiscoveryService）已用 sortByRecencyDesc 把列表排成
   * newest-first（有 created 按时间降序，无 created 按版本号兜底），所以这里
   * 最新代在前。auto-configure 会逐个 probe，找到第一个能 chat 通的。
   */
  private allMatches(availableIds: string[], patterns: string[]): string[] {
    const compiled: RegExp[] = [];
    for (const p of patterns) {
      try {
        compiled.push(new RegExp(p, "i"));
      } catch {
        // 跳过非法 regex
      }
    }
    if (compiled.length === 0) return [];
    return availableIds.filter((id) => compiled.some((re) => re.test(id)));
  }

  private findExistingConfig(
    existing: UserModelConfig[],
    provider: string,
    modelId: string,
    modelType: AIModelType,
  ): UserModelConfig | undefined {
    const normalizedModelId = modelId.toLowerCase();
    return existing.find(
      (config) =>
        config.provider === provider &&
        config.modelId.toLowerCase() === normalizedModelId &&
        config.modelType === modelType,
    );
  }

  /**
   * 用最小 prompt 探测 (provider, modelId) 能否实际 chat。
   * 复用 AiConnectionTestService（管理员/用户测试连接按钮也用这条路径）。
   * 15s 超时；图像/embedding/rerank 类型跳过 chat 探测（它们自有 endpoint 的测试分支）。
   */
  private async probeModelUsable(
    provider: string,
    modelId: string,
    apiKey: string,
    modelType: AIModelType,
  ): Promise<{ ok: boolean; reason?: string }> {
    try {
      const res = await this.connectionTest.testModelConnectionWithKey(
        provider,
        modelId,
        apiKey,
        "", // 交给 service 用 provider 默认 endpoint
        modelType,
      );
      if (res.success) return { ok: true };
      return { ok: false, reason: res.message };
    } catch (error) {
      return { ok: false, reason: (error as Error).message };
    }
  }

  private buildDisplayName(
    provider: string,
    modelId: string,
    modelType: AIModelType,
  ): string {
    const typeShort = {
      CHAT: "",
      CHAT_FAST: " Fast",
      CODE: " Code",
      MULTIMODAL: " Vision",
      IMAGE_GENERATION: " Image",
      IMAGE_EDITING: " Image Edit",
      EMBEDDING: " Embed",
      RERANK: " Rerank",
      EVALUATOR: " Eval",
    }[modelType];
    const providerShort =
      {
        openai: "OpenAI",
        anthropic: "Claude",
        google: "Gemini",
        xai: "Grok",
        deepseek: "DeepSeek",
        cohere: "Cohere",
        groq: "Groq",
        qwen: "Qwen",
        openrouter: "OpenRouter",
        minimax: "MiniMax",
      }[provider] ?? provider;
    return `${providerShort}${typeShort} (${modelId})`;
  }

  /**
   * 给 UserModelConfig 的 maxTokens 一个合理的上限。
   * 默认 4096 太保守——Leader Planning / Writing 经常要 8k-16k 输出，
   * 会被 callAPIWithConfig 的 `configLimit` clamp 导致 JSON 截断。
   */
  private inferMaxTokens(modelId: string, modelType: AIModelType): number {
    const lower = modelId.toLowerCase();

    // 推理模型（o1/o3/gpt-5/deepseek-r1）——reasoning tokens 要宽
    if (/^o[1-5]/i.test(lower) || lower.includes("gpt-5")) return 32000;

    // embedding / image / rerank 不走 chat 输出，用默认值即可
    if (
      modelType === AIModelType.EMBEDDING ||
      modelType === AIModelType.IMAGE_GENERATION ||
      modelType === AIModelType.IMAGE_EDITING ||
      modelType === AIModelType.RERANK
    ) {
      return 4096;
    }

    // 主流 CHAT 系列：gpt-4o / claude / gemini-pro 支持 16k 输出
    if (
      /^gpt-[4-9]/i.test(lower) ||
      lower.includes("claude") ||
      lower.includes("gemini") ||
      /^grok-[3-9]/i.test(lower)
    ) {
      return 16000;
    }

    // 其他 provider（deepseek / groq / cohere 等）保守 8k
    return 8000;
  }

  /**
   * ★ 2026-05-01 (mission 9a3144fc 真因): 之前未返回 apiFormat / apiEndpoint，
   *   auto-configure 出来的 BYOK 全部 api_format=openai / api_endpoint=NULL，
   *   xAI 模型被错路由到 OpenAI 端 → "requested resource not found"。
   *   现按 provider 推断这两个字段。
   */
  private inferProviderDefaults(provider: string): {
    apiFormat: string;
    apiEndpoint: string;
  } {
    const lower = (provider ?? "").toLowerCase();
    if (lower === "anthropic" || lower === "claude") {
      return {
        apiFormat: "anthropic",
        apiEndpoint: "https://api.anthropic.com/v1/messages",
      };
    }
    if (lower === "google" || lower === "gemini") {
      return {
        apiFormat: "google",
        apiEndpoint: "https://generativelanguage.googleapis.com/v1beta",
      };
    }
    if (lower === "xai" || lower === "grok") {
      return {
        apiFormat: "xai",
        apiEndpoint: "https://api.x.ai/v1/chat/completions",
      };
    }
    if (lower === "cohere") {
      return {
        apiFormat: "cohere",
        // H2 fix：v2 chat（adapter 发 v2-shaped body）。原写 /v1/chat 导致 v2 body
        // 打到 v1 端点 → 自动配置出来的 Cohere 模型运行时全坏 + 连接测试必失败。
        apiEndpoint: "https://api.cohere.com/v2/chat",
      };
    }
    if (lower === "deepseek") {
      return {
        apiFormat: "openai",
        apiEndpoint: "https://api.deepseek.com/v1/chat/completions",
      };
    }
    return {
      apiFormat: "openai",
      apiEndpoint: "https://api.openai.com/v1/chat/completions",
    };
  }

  private inferCapabilities(
    modelId: string,
    modelType: AIModelType,
    provider?: string,
  ): {
    isReasoning?: boolean;
    supportsTemperature?: boolean;
    tokenParamName?: string;
    supportsVision?: boolean;
    apiFormat?: string;
    apiEndpoint?: string;
  } {
    const lower = modelId.toLowerCase();

    // ★ 区分两个概念：
    //   (A) API 协议层：OpenAI 的 o1/o3/gpt-5 真推理系列走 max_completion_tokens 且不支持 temperature。
    //   (B) 能力层：LeaderPlanning 选"推理模型"时看的是"能不能做推理任务"（范围更宽）。
    // 两者都满足时才是 o1 那种特殊协议；只满足 (B) 的（如 gpt-4o、Claude 3.5 Sonnet）
    // 走普通 chat 协议但被允许承担 Leader 角色。
    const usesReasoningTokenProtocol =
      /^o[1-5]/i.test(lower) || lower.includes("gpt-5");

    const isReasoningCapable =
      usesReasoningTokenProtocol ||
      /^gpt-4o(?!-mini)/i.test(lower) ||
      /^gpt-4-turbo/i.test(lower) ||
      lower.includes("claude-3-5-sonnet") ||
      lower.includes("claude-sonnet-4") ||
      lower.includes("claude-3-opus") ||
      lower.includes("claude-opus") ||
      lower.includes("gemini-1.5-pro") ||
      lower.includes("gemini-2.0-pro") ||
      lower.includes("gemini-2.5-pro") ||
      /^grok-3(?!-mini)/i.test(lower) ||
      /^grok-4/i.test(lower) ||
      lower.includes("reasoner") ||
      lower.includes("deepseek-r");

    const supportsVision =
      modelType === AIModelType.MULTIMODAL ||
      /4o|vision|gemini|claude-3/i.test(lower);
    const providerDefaults = provider
      ? this.inferProviderDefaults(provider)
      : { apiFormat: "openai", apiEndpoint: undefined as string | undefined };
    return {
      isReasoning: isReasoningCapable,
      supportsTemperature: !usesReasoningTokenProtocol,
      tokenParamName: usesReasoningTokenProtocol
        ? "max_completion_tokens"
        : "max_tokens",
      supportsVision,
      apiFormat: providerDefaults.apiFormat,
      apiEndpoint: providerDefaults.apiEndpoint,
    };
  }
}
