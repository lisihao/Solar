/**
 * AiChatFailoverCallerService
 *
 * 抽自 AiChatService（2026-05-05）—— 把 BYOK per-key failover 路径独立成 service，
 * 让 ai-chat.service.ts 回到 god-class 阈值以下；行为/语义不变（PR-4 BYOK failover）。
 *
 * 职责：
 *   - userId 路径下：把 callAPIWithConfig 的 apiCall 包到 keyExecutor.execute()
 *   - 单 key 401/429/quota 自动切到下一把 PERSONAL/ASSIGNED key
 *   - 内层重试（同一把 key 上的 5xx）走 retryService 指数退避
 *   - 全部 key 失败抛 AllKeysFailedError；strictMode=true 时直接 rethrow
 *
 * 与 callAPIWithConfig 旧路径的区别：
 *   - 旧路径：resolveApiKey 单 key + retryService 内层重试（同 key 5xx）
 *   - 新路径：keyExecutor 外层换 key + retryService 内层重试（每个 key 都重试一遍）
 *
 * 错误语义：
 *   - 全部 key 401 → AllKeysFailedError（HTTP 403 + code=ALL_KEYS_FAILED）
 *   - provider 5xx → 抛原始 error（不切下一把，retryService 内层已重试）
 *   - 全部 key quota → AllKeysFailedError 携带 lastReason=QUOTA_EXCEEDED
 *
 * 依赖反转（DI）：
 *   - KeyExecutorService（@Optional 兼容老链路缺失场景，调用方负责检查）
 *   - AiApiCallerService（4 provider API 转发）
 *   - AiChatRetryService（同 key 内层重试）
 *   - AiModelConfigService（isReasoningModel 用于 timeout 推断）
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import { ChatMessage } from "../types";
import {
  AIModelConfig,
  AiModelConfigService,
} from "../models/config/ai-model-config.service";
import { AiApiCallerService } from "../providers/ai-api-caller.service";
import { AiChatRetryService } from "./ai-chat-retry.service";
import { KeyExecutorService } from "@/modules/platform/credentials/resolution/executor";
import { BYOKError } from "@/modules/platform/credentials/resolution/key-resolver/key-resolver.errors";
import type { ChatCompletionResult } from "./ai-chat.service";
import type { StructuredOutputStrategy } from "../output/structured/structured-output-strategy.types";
import type { FunctionDefinition } from "../../tools/abstractions/tool.interface";
import { inferIsReasoning } from "../types/model.utils";

@Injectable()
export class AiChatFailoverCallerService {
  private readonly logger = new Logger(AiChatFailoverCallerService.name);

  constructor(
    private readonly apiCallerService: AiApiCallerService,
    private readonly retryService: AiChatRetryService,
    private readonly modelConfigService: AiModelConfigService,
    @Optional() private readonly keyExecutor?: KeyExecutorService,
  ) {}

  isAvailable(): boolean {
    return this.keyExecutor != null;
  }

  // ★ 2026-06-02 BYOK throttle resilience — rpm 节流（opt-in，pod 内单例）
  /** per-(user+model) 下一可用时隙时间戳；用于按 rpm 均匀间隔放行 */
  private readonly rpmNextSlotAt = new Map<string, number>();
  /** rpmLimit 查询的短 TTL 缓存，避免每次 LLM 调用都打 DB */
  private readonly rpmCache = new Map<
    string,
    { rpm: number | null; at: number }
  >();
  private static readonly RPM_CACHE_TTL_MS = 60_000;
  private static readonly RPM_MAX_WAIT_MS = 120_000;
  // L4 fix：两个 per-(user,model) Map 仅 get/set、无界增长（rpmCache 连 null-rpm
  // 也缓存 → 对所有 user×model 增长）。周期性清扫 idle 条目防 long-running pod 泄漏。
  private static readonly RPM_SWEEP_EVERY = 500;
  private rpmOpCount = 0;

  /**
   * 让用户在「添加模型配置」里显式配的 rpmLimit 真正生效：按 rpm 均匀间隔放行调用，
   * 从源头避免把弱 provider（如 Agnes Starter 套餐 1500 次/5h）打到节流 401。
   * **严格 opt-in**：未配 rpmLimit（null/<=0）→ 直接返回，零行为变化。
   * 单 pod 进程内节流（与 keyExecutor 并发槽同范围）；多 pod 由各自承担其份额。
   */
  private async paceByConfiguredRpm(
    userId: string,
    modelId: string,
  ): Promise<void> {
    const cacheKey = `${userId}:${modelId}`;
    const now = Date.now();
    if (++this.rpmOpCount % AiChatFailoverCallerService.RPM_SWEEP_EVERY === 0) {
      this.sweepRpmMaps(now);
    }
    let entry = this.rpmCache.get(cacheKey);
    if (
      !entry ||
      now - entry.at > AiChatFailoverCallerService.RPM_CACHE_TTL_MS
    ) {
      const rl = await this.modelConfigService.getRateLimitForUserModel(
        userId,
        modelId,
      );
      entry = { rpm: rl?.rpmLimit ?? null, at: now };
      this.rpmCache.set(cacheKey, entry);
    }
    const rpm = entry.rpm;
    if (!rpm || rpm <= 0) return; // opt-in：未配 → 不节流

    const intervalMs = 60_000 / rpm;
    const t = Date.now();
    // 同步预订下一时隙（在任何 await 之前完成 → 并发安全，不会两路抢同一时隙）
    const scheduledAt = Math.max(t, this.rpmNextSlotAt.get(cacheKey) ?? 0);
    this.rpmNextSlotAt.set(cacheKey, scheduledAt + intervalMs);
    const wait = scheduledAt - t;
    if (wait > 0) {
      await this.retryService.sleep(
        Math.min(wait, AiChatFailoverCallerService.RPM_MAX_WAIT_MS),
      );
    }
  }

  /** L4：清扫无界增长的 rpm Map —— 删 TTL 过期的 rpmCache 与已远过去时隙的 rpmNextSlotAt。 */
  private sweepRpmMaps(now: number): void {
    const ttl = AiChatFailoverCallerService.RPM_CACHE_TTL_MS;
    for (const [k, v] of this.rpmCache) {
      if (now - v.at > ttl) this.rpmCache.delete(k);
    }
    for (const [k, slot] of this.rpmNextSlotAt) {
      if (slot < now - ttl) this.rpmNextSlotAt.delete(k);
    }
  }

  /**
   * 为流式路径（chatStream 不走 execute()）占用 per-(user+provider) 并发槽。
   * 返回 release 函数；keyExecutor 不可用时返回 null（调用方跳过节流）。
   */
  async acquireProviderSlot(
    userId: string,
    provider: string,
  ): Promise<(() => void) | null> {
    if (!this.keyExecutor) return null;
    return this.keyExecutor.acquireProviderSlot(userId, provider);
  }

  /**
   * 流式调用完成后记账：标记 key HEALTHY + 更新 LastGood（粘性）
   * AiChatService.chatStream 在流末尾 yield done:true 后调用
   */
  async trackSuccess(
    healthKeyId: string,
    provider: string,
    userId: string,
  ): Promise<void> {
    if (!this.keyExecutor) return;
    await this.keyExecutor.trackSuccess(healthKeyId, provider, userId);
  }

  /**
   * 流式调用失败时记账：分类 401/403/quota/429 → DEAD/COOLDOWN
   * 流式无法做 mid-stream failover，但能让下次 resolveKeyChain 跳过坏 key
   */
  async trackFailure(
    healthKeyId: string,
    provider: string,
    error: unknown,
  ): Promise<void> {
    if (!this.keyExecutor) return;
    await this.keyExecutor.trackFailure(healthKeyId, provider, error);
  }

  async callAPIWithFailover(
    userId: string,
    config: AIModelConfig,
    messages: ChatMessage[],
    maxTokens: number,
    temperature: number | undefined,
    optionStrictMode: boolean | undefined,
    responseFormat: string | undefined,
    reasoningDepth: import("../types").ReasoningDepth | undefined,
    cachePolicy: "auto" | undefined,
    outputSchema:
      | { type: "json_schema"; schema: Record<string, unknown> }
      | undefined,
    structuredOutputStrategy?: StructuredOutputStrategy,
    outputJsonSchema?: Record<string, unknown>,
    schemaName?: string,
    tools?: FunctionDefinition[],
  ): Promise<ChatCompletionResult> {
    if (!this.keyExecutor) {
      throw new Error("KeyExecutor not available — should not reach here");
    }
    const { modelId, apiEndpoint, provider } = config;
    const apiFormat = config.apiFormat || "openai";
    // ★ 用 || 而非 ??：DB isReasoning 是 Boolean @default(false) NOT NULL，
    //   "用户漏标"塌缩为 false（非 null），?? 不触发兜底。|| 让 false/undefined
    //   都回退 modelId 启发式，救回被漏标的 reasoning 模型（gpt-5.x/o1/o3/o4），
    //   否则发 max_tokens → OpenAI INVALID_REQUEST 全失败。admin 若需强制非推理，
    //   显式设 tokenParamName=max_tokens（直读、不被覆盖）。
    const isReasoning = config.isReasoning || inferIsReasoning(modelId);
    // ★ reasoning 模型（OpenAI o1/o3/gpt-5）硬性拒绝任何 temperature 参数（发即
    //   400 "Unsupported value: temperature"）。不论 DB supportsTemperature 如何，
    //   reasoning 一律不发 temperature；非 reasoning 才尊重 config（缺省 true）。
    //   修 chapter-reviewer 等 deterministic(temperature) agent 用漏标 gpt-5.4 时
    //   reviewer failed（400 假失败 → 章节兜底 40 分）的根因——与 connection-test
    //   同款 temperature bug，业务调用路径此前漏修。
    const supportsTemp = isReasoning
      ? false
      : (config.supportsTemperature ?? true);
    const tokenParamName =
      config.tokenParamName ||
      (isReasoning ? "max_completion_tokens" : "max_tokens");

    const configLimit = config.maxTokens;
    if (configLimit > 0 && maxTokens > configLimit) {
      this.logger.warn(
        `[callAPIWithFailover] Clamping maxTokens from ${maxTokens} to model limit ${configLimit} for ${modelId}`,
      );
      maxTokens = configLimit;
    }

    // ★ 修复：用 Math.max 而非 || 短路，避免 UserModelConfig.defaultTimeoutMs
    // 默认值 120000（schema @default）让 reasoning model 永远走不到 540s+ 的 timeout 算法。
    // configured 仍允许 admin/用户显式调大（如 900000），但不会被低于推荐值的旧默认值卡死。
    const computedTimeout = this.modelConfigService.getTimeoutForModel(
      modelId,
      maxTokens,
    );
    const configuredTimeout = config.defaultTimeoutMs ?? 0;
    const timeout = Math.max(computedTimeout, configuredTimeout);
    const useStrictMode = optionStrictMode ?? false;
    const effectiveTemperature = supportsTemp ? temperature : undefined;

    // ★ rpm 节流（opt-in）：用户显式配了该模型 rpmLimit 时，按 rpm 均匀放行，
    //   从源头避免把弱 provider 打到节流 401。未配则零开销 no-op。
    await this.paceByConfiguredRpm(userId, modelId);

    try {
      const result = await this.keyExecutor.execute(
        userId,
        provider,
        async (key) => {
          const apiKey = key.apiKey;
          const effectiveEndpoint = key.apiEndpoint || apiEndpoint;

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
                  provider, // v3.1 §A: 让 ModelCapabilityService 判 nativeMode==='none'
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
                  provider, // v3.1 §A: 让 ModelCapabilityService 判 nativeMode==='none'
                );
            }
          };
          // ★ 2026-06-02 BYOK throttle resilience：若这把 key 近期成功过，则把 401 当
          //   provider 并发/速率压力下的瞬时假性鉴权失败（如 Agnes new-api 网关「无效的令牌」），
          //   退避重试而非立即放弃 —— 否则单 key 用户撞一次节流整章就阵亡。
          const keyRecentlyHealthy =
            await this.keyExecutor!.isKeyRecentlyHealthy(key.healthKeyId);
          // 内层重试：同一把 key 上的 5xx 走 retryService 指数退避；
          // 抛出后 KeyExecutor 才接管 key 切换
          return await this.retryService.withExponentialBackoff(
            apiCall,
            `callAPIWithFailover [${modelId}|${key.healthKeyId}]`,
            provider,
            { retryTransient401: keyRecentlyHealthy },
          );
        },
      );
      result.apiKeySource = result.apiKeySource ?? "personal"; // BYOK 路径都打 personal/assigned 标
      return result;
    } catch (error) {
      // BYOKError（含 AllKeysFailedError / ProviderCooldownError / InvalidApiKeyError）
      // 直接上抛，让 HTTP 层按 code 返回结构化错误
      if (error instanceof BYOKError) throw error;
      if (useStrictMode) throw error;
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[callAPIWithFailover] ${provider} API failed after failover: ${errorMsg}`,
      );
      return {
        content: `**${provider} API 调用失败**\n\n模型：${modelId}\n错误信息：${errorMsg}\n\n请稍后重试或检查 API 配置。`,
        model: modelId,
        tokensUsed: 0,
        isError: true,
      };
    }
  }
}
