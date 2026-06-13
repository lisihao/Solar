/**
 * ChatFacade — Domain Facade for LLM Chat, Streaming, and Model Operations
 *
 * Responsibilities:
 * - LLM chat (single-model, fallback, streaming, structured output)
 * - Model selection and configuration queries
 * - Billing / credits deduction
 * - Skill-injected chat proxy
 * - Admin: model listing and connection testing
 *
 * @Injectable — registered as a NestJS provider in facade.providers.ts
 */

import {
  Injectable,
  Logger,
  Optional,
  Inject,
  forwardRef,
} from "@nestjs/common";
import { AIModelType } from "@prisma/client";
import { AiChatService } from "../../../ai-engine/llm/chat/ai-chat.service";
import { AiModelConfigService } from "../../../ai-engine/llm/models/config/ai-model-config.service";
import { ModelFallbackService } from "../../../ai-engine/llm/models/selection/model-fallback.service";
import { TaskCompletionType } from "../../../ai-engine/reliability/entity-health/entity-health.registry";
import {
  CreditsService,
  BillingContext,
  InsufficientCreditsException,
} from "../../../platform/facade";
// PR-X9: BYOKError 已搬到 platform/credentials/resolution/key-resolver
import { BYOKError } from "../../../platform/credentials/resolution/key-resolver/key-resolver.errors";
import { RequestContext } from "../../../../common/context/request-context";
import { ModelSubFacade } from "../sub-facades/model.sub-facade";
import type { ModelResolverService } from "../model-resolver.service";
import type {
  OrchestrationFeature,
  SkillFeature,
  ConstraintFeature,
} from "../facade.providers";
import {
  ORCHESTRATION_FEATURE,
  SKILL_FEATURE,
  CONSTRAINT_FEATURE,
} from "../facade.providers";
import type { CreditBillingInfo } from "../types/facade.types";
import type { QueryLoopConfig } from "../../../ai-harness/runner/executor/query-loop.service";
import type {
  ChatRequest,
  ChatResponse,
  ModelInfo,
  ModelSelectionOptions,
} from "../types";
import type {
  ChatWithSkillsRequest,
  ChatWithSkillsResponse,
} from "../../../ai-engine/skills/types/skill-md.types";
import type {
  StructuredChatRequest,
  StructuredChatResponse,
} from "../types/facade.types";
import type { ConstraintConfig, ConstraintResult } from "../types/facade.types";

/** Skills 系统提示词 Token 预算 */
const SKILLS_PROMPT_TOKEN_BUDGET = 4000;

/** 敏感词过滤列表（基础版） */
const SENSITIVE_PATTERNS = [
  /password\s*[:=]\s*\S+/gi,
  /api[_-]?key\s*[:=]\s*\S+/gi,
  /secret\s*[:=]\s*\S+/gi,
  /token\s*[:=]\s*\S+/gi,
  /bearer\s+\S+/gi,
];

/**
 * Short-lived (30s) negative cache to avoid repeated DB lookups for zero-balance users.
 *
 * 2026-05-15 PR-E.P2: 保留 in-process（不迁 Redis）。理由：
 *   - 30s TTL 的 negative cache，多 pod 各自 cache 不影响正确性，最差性能轻微下降
 *   - 跨 pod 共享需 Redis SET EX 每次 RTT 1-2ms，比直接 DB lookup（10-50ms）省，
 *     但还不如 in-process Map（<0.1ms）；引入 Redis 反而是性能反优化
 *   - 充值后 user 转过来时最长 30s 仍可能命中 cache 显示余额不足——可接受
 *   - YAGNI：不为不存在的"跨 pod 缓存一致性"问题增复杂度
 */
const ZERO_BALANCE_CACHE_TTL = 30_000; // 30 seconds
const zeroBalanceCache = new Map<string, number>(); // userId → expiry timestamp

@Injectable()
export class ChatFacade {
  private readonly logger = new Logger(ChatFacade.name);

  private readonly modelSub: ModelSubFacade;

  constructor(
    private readonly aiChatService: AiChatService,
    modelConfigService: AiModelConfigService,
    @Optional() private readonly modelFallbackService?: ModelFallbackService,
    @Optional()
    @Inject(forwardRef(() => CreditsService))
    private readonly creditsService?: CreditsService,
    @Optional()
    @Inject(ORCHESTRATION_FEATURE)
    private readonly orchestration?: OrchestrationFeature,
    @Optional()
    @Inject(SKILL_FEATURE)
    private readonly skills?: SkillFeature,
    @Optional()
    @Inject(CONSTRAINT_FEATURE)
    private readonly constraint?: ConstraintFeature,
    @Optional() modelResolver?: ModelResolverService,
  ) {
    this.modelSub = new ModelSubFacade(
      aiChatService,
      modelConfigService,
      modelFallbackService,
      orchestration,
      modelResolver,
    );
  }

  // ==================== Core Chat ====================

  async chat(request: ChatRequest): Promise<ChatResponse> {
    // ★ 2026-05-05 [严格 BYOK 风险 2] userId 兜底由下游 AiChatService.chat
    //   line 1337 防呆（BYOK v2: userId is required → UnauthorizedException）。
    //   ChatFacade 这一层不重复检查，避免大量已有 spec mock 路径 break。
    //   双层防御本身是冗余 — 单层 ai-chat 防呆已足够拦截未登录 / 后台误调。

    // Step 0: Pre-check credits (avoid executing LLM call when user has no credits)
    const creditCheckResult = await this.preCheckCredits(request);
    if (creditCheckResult !== null) {
      return creditCheckResult;
    }

    // Step 1: Skill proxy
    const skillResult = await this.handleSkillProxy(request);
    if (skillResult !== null) {
      return skillResult;
    }

    // Step 2: Resolve model ID
    const modelId = await this.resolveModelId(request);
    const entityId = `chat:${modelId}`;

    // ★ 入口拦截：modelId 在 ModelFallbackService 的黑名单里（10-min TTL）
    // 就直接短路，不再调 API、不再走 fallback 链。避免被 Non-retryable
    // 错误（INVALID_MODEL / INVALID_API_KEY）淹没日志 + 烧配额。
    if (
      typeof this.modelFallbackService?.isModelBlocked === "function" &&
      this.modelFallbackService.isModelBlocked(modelId)
    ) {
      this.logger.warn(
        `[chat] Model ${modelId} is blocklisted (10-min TTL). Short-circuit, no API call.`,
      );
      return {
        content: `Model ${modelId} is temporarily unavailable (authentication or access issue). Please check your API Key configuration in "AI 配置".`,
        model: modelId,
        tokensUsed: 0,
        isError: true,
      };
    }

    // ★ 诊断：计算实际消息大小，帮助定位异常大 prompt
    const CHARS_PER_TOKEN = 4;
    const LARGE_PROMPT_TOKEN_THRESHOLD = 50_000;
    const totalMsgChars = request.messages.reduce((sum, m) => {
      const contentLen =
        typeof m.content === "string"
          ? m.content.length
          : JSON.stringify(m.content || "").length;
      return sum + contentLen;
    }, 0);
    const estimatedInputTokens = Math.ceil(totalMsgChars / CHARS_PER_TOKEN);

    this.logger.debug(
      `[chat] modelType=${request.modelType}, model=${modelId}, messages=${request.messages.length}, totalChars=${totalMsgChars}, ~${estimatedInputTokens} tokens`,
    );

    // ★ 异常大 prompt 预警，包含每条消息的大小分解
    if (estimatedInputTokens > LARGE_PROMPT_TOKEN_THRESHOLD) {
      const msgBreakdown = request.messages.map((m, i) => {
        const len =
          typeof m.content === "string"
            ? m.content.length
            : JSON.stringify(m.content || "").length;
        return `msg[${i}](${m.role}):${len}`;
      });
      this.logger.error(
        `[chat] ⚠ LARGE PROMPT: ~${estimatedInputTokens} tokens, breakdown=[${msgBreakdown.join(", ")}], ` +
          `stack=${new Error().stack?.split("\n").slice(1, 8).join(" → ")}`,
      );
    }

    // Step 3: Enforce constraints
    const constraintError = await this.enforceRateLimitAndBudget(
      request,
      modelId,
    );
    if (constraintError !== null) {
      return constraintError;
    }

    // Step 4: Route to provider
    if (this.modelFallbackService) {
      return this.chatWithFallback(request, modelId);
    }

    return this.chatSingleModel(request, modelId, entityId);
  }

  // ==================== chatWithLoop ====================

  /**
   * Execute a chat request with automatic multi-turn continuation on truncated output.
   *
   * Falls back to regular `chat()` when QueryLoopService is not available in the
   * current DI context (e.g. lightweight module configurations).
   *
   * @param request - Same parameters as `chat()`
   * @param loopConfig - Optional QueryLoop configuration overrides
   * @returns Assembled ChatResponse with full content across all continuations
   */
  async chatWithLoop(
    request: ChatRequest,
    loopConfig?: QueryLoopConfig,
  ): Promise<ChatResponse> {
    const queryLoopService = this.orchestration?.queryLoop;

    if (!queryLoopService) {
      this.logger.debug(
        "[chatWithLoop] QueryLoopService not available, falling back to chat()",
      );
      return this.chat(request);
    }

    const chatFn = async (
      messages: Array<{ role: string; content: string }>,
    ): Promise<{
      content: string;
      model: string;
      tokensUsed: number;
      inputTokens?: number;
      outputTokens?: number;
      isError?: boolean;
      finishReason?: string;
    }> => {
      // QueryLoopService passes plain-string messages; ChatRequest accepts string | ContentPart[]
      const result = await this.chat({
        ...request,
        messages: messages as ChatRequest["messages"],
      });
      return {
        content: result.content,
        model: result.model,
        tokensUsed: result.tokensUsed,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        isError: result.isError,
        finishReason: result.finishReason,
      };
    };

    // QueryLoopService requires plain-string content; stringify multipart messages
    const initialMessages = request.messages.map((m) => ({
      role: m.role,
      content:
        typeof m.content === "string" ? m.content : JSON.stringify(m.content),
    }));

    const loopResult = await queryLoopService.executeWithLoop(
      chatFn,
      initialMessages,
      loopConfig,
    );

    if (loopResult.continuations > 0) {
      this.logger.log(
        `[chatWithLoop] Completed with ${loopResult.continuations} continuation(s), stoppedReason=${loopResult.stoppedReason}, totalTokens=${loopResult.totalInputTokens + loopResult.totalOutputTokens}`,
      );
    }

    return {
      content: loopResult.content,
      model: request.model || "",
      tokensUsed: loopResult.totalInputTokens + loopResult.totalOutputTokens,
      inputTokens: loopResult.totalInputTokens,
      outputTokens: loopResult.totalOutputTokens,
      finishReason: loopResult.stoppedReason === "complete" ? "stop" : "length",
      isError: loopResult.stoppedReason === "error",
    };
  }

  private async handleSkillProxy(
    request: ChatRequest,
  ): Promise<ChatResponse | null> {
    if (!(request.domain || request.query) || !this.skills) {
      return null;
    }

    this.logger.debug(
      `[chat] Auto-delegating to chatWithSkills (domain=${request.domain}, query=${request.query})`,
    );

    const skillResponse = await this.chatWithSkills({
      messages: request.messages,
      modelType: request.modelType,
      model: request.model,
      taskProfile: request.taskProfile || {
        creativity: "medium",
        outputLength: "standard",
      },
      maxTokens: request.maxTokens,
      temperature: request.temperature,
      strictMode: request.strictMode,
      domain: request.domain || "common",
      query: request.query,
      additionalSkills: request.additionalSkills,
      skillContext: request.skillContext,
      skipGuardrails: request.skipGuardrails,
    });

    return {
      content: skillResponse.content,
      model: skillResponse.model,
      tokensUsed: skillResponse.tokensUsed,
      isError: skillResponse.isError,
    };
  }

  private async resolveModelId(request: ChatRequest): Promise<string> {
    if (request.model) {
      return request.model;
    }

    if (request.modelType) {
      const defaultModel = await this.aiChatService.getDefaultModelByType(
        request.modelType as AIModelType,
      );
      if (defaultModel) {
        return defaultModel.modelId;
      }
    }

    return "";
  }

  private async enforceRateLimitAndBudget(
    request: ChatRequest,
    modelId: string,
  ): Promise<ChatResponse | null> {
    if (this.constraint?.rateLimiter) {
      const rateLimitKey = request.billing?.userId || "global";
      const rl = await this.constraint.rateLimiter.checkAndConsume("chat", {
        tenantId: rateLimitKey,
      });
      if (!rl.allowed) {
        this.logger.warn(
          `[chat] Rate limited for key=${rateLimitKey}, retryAfter=${rl.retryAfterMs}ms`,
        );
        return {
          content: `Rate limit exceeded. Please try again in ${Math.ceil((rl.retryAfterMs || 0) / 1000)} seconds.`,
          model: modelId,
          tokensUsed: 0,
          isError: true,
        };
      }
    }

    if (this.constraint?.costController) {
      const budgetCheck = this.constraint.costController.checkBudget(0.01);
      if (!budgetCheck.allowed) {
        this.logger.warn(`[chat] Budget exceeded: ${budgetCheck.reason}`);
        return {
          content: `Budget limit exceeded: ${budgetCheck.reason}`,
          model: modelId,
          tokensUsed: 0,
          isError: true,
        };
      }
    }

    return null;
  }

  private async chatWithFallback(
    request: ChatRequest,
    preferredModelId: string,
  ): Promise<ChatResponse> {
    const startTime = Date.now();

    const fallbackResult = await this.modelFallbackService!.executeWithFallback(
      preferredModelId,
      async (modelConfig) => {
        const result = await this.aiChatService.chat({
          messages: request.messages,
          systemPrompt: request.systemPrompt,
          modelType: request.modelType || AIModelType.CHAT,
          taskProfile: request.taskProfile,
          model: modelConfig.modelId,
          maxTokens: request.maxTokens,
          temperature: request.temperature,
          responseFormat: request.responseFormat,
          strictMode: request.strictMode,
          userId: request.billing?.userId ?? RequestContext.getUserId(),
          processId: request.processId,
          skipGuardrails: request.skipGuardrails,
          trustedInternal: request.trustedInternal,
          cachePolicy: request.cachePolicy,
          outputSchema: request.outputSchema,
          sharedCachePrefix: request.sharedCachePrefix,
          operationName: request.operationName,
        });

        if (result.isError) {
          throw new Error(result.content);
        }

        return result;
      },
      {
        modelType: request.modelType || AIModelType.CHAT,
        operation: "facade_chat",
        maxRetries: 1,
        maxModelSwitches: 3,
      },
    );

    const duration = Date.now() - startTime;

    if (fallbackResult.fallbackUsed) {
      this.logger.warn(
        `[chat] Model fallback used: ${fallbackResult.attemptedModels.join(" → ") || fallbackResult.modelUsed} → final=${fallbackResult.modelUsed} (${fallbackResult.attempts} attempts, ${duration}ms)`,
      );
    }

    if (fallbackResult.success && fallbackResult.data) {
      const result = fallbackResult.data;
      const tokensUsed = result.usage?.totalTokens || 0;

      const entityId = `chat:${result.model}`;
      this.orchestration?.circuitBreaker?.recordSuccess(entityId, duration);

      await this.handleBilling(
        request,
        result.apiKeySource,
        tokensUsed,
        result.model,
        {
          inputTokens: result.usage?.inputTokens,
          outputTokens: result.usage?.outputTokens,
          cacheCreationTokens: result.usage?.cacheCreationTokens,
          cacheReadTokens: result.usage?.cacheReadTokens,
        },
      );

      this.logger.log(
        `[chat] Completed in ${duration}ms, model=${result.model}, tokens=${tokensUsed}${fallbackResult.fallbackUsed ? " (fallback)" : ""}`,
      );

      return {
        content: result.content,
        model: result.model,
        tokensUsed,
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
        finishReason: result.finishReason,
        isError: false,
      };
    }

    const errorMsg = fallbackResult.error?.message || "All models failed";
    this.logger.error(
      `[chat] All models failed after ${duration}ms (tried: ${fallbackResult.attemptedModels.join(", ")}): ${errorMsg}`,
    );

    if (request.strictMode) {
      throw new Error(errorMsg);
    }

    return {
      content: `Error: ${errorMsg}`,
      model: fallbackResult.modelUsed || preferredModelId,
      tokensUsed: 0,
      isError: true,
    };
  }

  private async chatSingleModel(
    request: ChatRequest,
    modelId: string,
    entityId: string,
  ): Promise<ChatResponse> {
    if (
      this.orchestration?.circuitBreaker &&
      !this.orchestration.circuitBreaker.canExecute(entityId)
    ) {
      const cooldown =
        this.orchestration.circuitBreaker.getCooldownRemaining(entityId);
      this.logger.warn(
        `[chat] Circuit breaker OPEN for ${entityId}, cooldown=${cooldown}ms`,
      );
      return {
        content: `Service temporarily unavailable. Please try again in ${Math.ceil(cooldown / 1000)} seconds.`,
        model: modelId,
        tokensUsed: 0,
        isError: true,
      };
    }

    const startTime = Date.now();

    try {
      this.orchestration?.circuitBreaker?.incrementLoad(entityId);

      const result = await this.aiChatService.chat({
        messages: request.messages,
        systemPrompt: request.systemPrompt,
        modelType: request.modelType || AIModelType.CHAT,
        taskProfile: request.taskProfile,
        model: request.model,
        maxTokens: request.maxTokens,
        temperature: request.temperature,
        responseFormat: request.responseFormat,
        strictMode: request.strictMode,
        userId: request.billing?.userId ?? RequestContext.getUserId(),
        processId: request.processId,
        skipGuardrails: request.skipGuardrails,
        trustedInternal: request.trustedInternal,
        cachePolicy: request.cachePolicy,
        outputSchema: request.outputSchema,
        sharedCachePrefix: request.sharedCachePrefix,
        operationName: request.operationName,
      });

      const duration = Date.now() - startTime;

      if (!result.isError) {
        this.orchestration?.circuitBreaker?.recordSuccess(entityId, duration);
      } else {
        this.orchestration?.circuitBreaker?.recordFailure(
          entityId,
          TaskCompletionType.API_ERROR,
          result.content.slice(0, 100),
        );
      }

      const tokensUsed = result.usage?.totalTokens || 0;

      if (!result.isError) {
        await this.handleBilling(
          request,
          result.apiKeySource,
          tokensUsed,
          result.model,
          {
            inputTokens: result.usage?.inputTokens,
            outputTokens: result.usage?.outputTokens,
            cacheCreationTokens: result.usage?.cacheCreationTokens,
            cacheReadTokens: result.usage?.cacheReadTokens,
          },
        );
      }

      return {
        content: result.content,
        model: result.model,
        tokensUsed,
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
        finishReason: result.finishReason,
        isError: result.isError,
      };
    } catch (error) {
      // BYOK 错误（用户 Key / 配额 / 系统 Secret 缺失）直接透传给 HTTP 层，
      // 由 Nest 转成 403 + code；不吞成 isError=true 的文本，避免被当作
      // AI 回复渲染到聊天区。也不记到 circuit breaker（模型本身是好的）。
      if (error instanceof BYOKError) {
        throw error;
      }

      const duration = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : String(error);

      const errorType =
        this.orchestration?.circuitBreaker?.parseErrorType(errorMsg) ||
        TaskCompletionType.API_ERROR;
      this.orchestration?.circuitBreaker?.recordFailure(
        entityId,
        errorType,
        errorMsg,
      );

      this.logger.error(`[chat] Failed after ${duration}ms: ${errorMsg}`);

      if (request.strictMode) {
        throw error;
      }

      return {
        content: `Error: ${errorMsg}`,
        model: modelId,
        tokensUsed: 0,
        isError: true,
      };
    } finally {
      this.orchestration?.circuitBreaker?.decrementLoad(entityId);
    }
  }

  // ==================== chatWithSkills ====================

  async chatWithSkills(
    request: ChatWithSkillsRequest,
  ): Promise<ChatWithSkillsResponse> {
    const startTime = Date.now();

    // Auto-extract query from last user message if not provided
    const query =
      request.query || this.extractQueryFromMessages(request.messages);

    this.logger.log(
      `[Skills] chatWithSkills START: query="${query?.slice(0, 60) || ""}", domain="${request.domain || ""}"`,
    );

    if (!this.skills?.loader || !this.skills?.promptBuilder) {
      this.logger.warn(
        "[Skills] Skills services not available, falling back to plain chat",
      );
      const result = await this.chat({
        messages: request.messages,
        modelType: request.modelType as AIModelType,
        model: request.model,
        taskProfile: request.taskProfile,
        maxTokens: request.maxTokens,
        temperature: request.temperature,
        responseFormat: request.responseFormat,
        strictMode: request.strictMode,
        skipGuardrails: request.skipGuardrails,
        operationName: request.operationName,
      });

      return {
        content: result.content,
        model: result.model,
        tokensUsed: result.tokensUsed,
        isError: result.isError,
        usedSkills: [],
        skillsTokensUsed: 0,
      };
    }

    const skills = await this.skills.loader.getSkillsForTask({
      query,
      domain: request.domain,
      additionalSkillIds: request.additionalSkills,
      maxTokenBudget: SKILLS_PROMPT_TOKEN_BUDGET,
    });

    const buildResult = this.skills.promptBuilder.buildSystemPrompt(skills, {
      context: request.skillContext,
      maxTokens: SKILLS_PROMPT_TOKEN_BUDGET,
      includeMetadata: false,
    });

    const messagesWithSkills = [
      ...(buildResult.prompt
        ? [{ role: "system" as const, content: buildResult.prompt }]
        : []),
      ...request.messages,
    ];

    const result = await this.chat({
      messages: messagesWithSkills,
      modelType: request.modelType as AIModelType,
      model: request.model,
      taskProfile: request.taskProfile,
      maxTokens: request.maxTokens,
      temperature: request.temperature,
      responseFormat: request.responseFormat,
      strictMode: request.strictMode,
      skipGuardrails: request.skipGuardrails,
      cachePolicy: request.cachePolicy,
      operationName: request.operationName,
    });

    const duration = Date.now() - startTime;

    this.logger.log(
      `[Skills] chatWithSkills COMPLETE: ${buildResult.usedSkills.length} skills, ${buildResult.estimatedTokens} skill tokens, ${duration}ms`,
    );

    // Fire-and-forget: log each used skill to AIUsageLog for analytics
    if (this.skills.logUsage && buildResult.usedSkills.length > 0) {
      this.skills.logUsage({
        skillIds: buildResult.usedSkills,
        success: !result.isError,
        duration,
        tokensUsed: result.tokensUsed || undefined,
        model: result.model || undefined,
        domain: request.domain,
        userId: RequestContext.getUserId() ?? undefined,
      });
    }

    return {
      content: result.content,
      model: result.model,
      tokensUsed: result.tokensUsed,
      isError: result.isError,
      usedSkills: buildResult.usedSkills,
      skillsTokensUsed: buildResult.estimatedTokens,
    };
  }

  // ==================== Streaming ====================

  async *chatStream(
    request: ChatRequest,
  ): AsyncGenerator<
    { content: string; done: boolean; error?: string },
    void,
    unknown
  > {
    this.logger.debug(
      `[chatStream] modelType=${request.modelType}, messages=${request.messages.length}`,
    );

    const modelId = request.model || request.modelType || "default";
    const entityId = `chat:${modelId}`;

    if (
      this.orchestration?.circuitBreaker &&
      !this.orchestration.circuitBreaker.canExecute(entityId)
    ) {
      const cooldown =
        this.orchestration.circuitBreaker.getCooldownRemaining(entityId);
      this.logger.warn(
        `[chatStream] Circuit breaker OPEN for ${entityId}, cooldown=${cooldown}ms`,
      );
      yield {
        content: `Service temporarily unavailable. Please try again in ${Math.ceil(cooldown / 1000)} seconds.`,
        done: true,
        error: "CIRCUIT_BREAKER_OPEN",
      };
      return;
    }

    // 评审 2026-05-09 [BLOCKER B1]：handleBilling 必须在 finally 内，
    // 否则消费方对生成器 break/throw（chunk.error 提前退出 / signal.aborted）时
    // 会触发 iterator.return()，post-yield 的 handleBilling 整段不执行 → 漏扣。
    // 变量提到 try 外让 finally 能读；handleBilling 自身用 try-catch 兜住避免 finally 抛错吞掉原始 abort signal。
    let streamApiKeySource: string | undefined;
    let tokensUsed = 0;
    let accumulatedContentLength = 0;

    try {
      this.orchestration?.circuitBreaker?.incrementLoad(entityId);

      for await (const chunk of this.aiChatService.chatStream({
        messages: request.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        model: request.model,
        modelType: request.modelType,
        taskProfile: request.taskProfile,
        systemPrompt: request.systemPrompt,
        maxTokens: request.maxTokens,
        temperature: request.temperature,
        userId: request.billing?.userId ?? RequestContext.getUserId(),
      })) {
        if (chunk.apiKeySource) {
          streamApiKeySource = chunk.apiKeySource;
        }

        if (chunk.usage) {
          tokensUsed = chunk.usage.totalTokens;
        }

        if (chunk.content) {
          accumulatedContentLength += chunk.content.length;
        }

        yield { content: chunk.content, done: chunk.done, error: chunk.error };

        if (chunk.error) {
          this.orchestration?.circuitBreaker?.recordFailure(
            entityId,
            TaskCompletionType.API_ERROR,
            chunk.error,
          );
        }
      }

      this.orchestration?.circuitBreaker?.recordSuccess(entityId, 0);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.orchestration?.circuitBreaker?.recordFailure(
        entityId,
        TaskCompletionType.API_ERROR,
        errorMsg,
      );

      this.logger.error(`[chatStream] Stream failed: ${errorMsg}`);
      yield { content: "", done: true, error: errorMsg };
    } finally {
      // Token 估算 fallback（provider 不 yield usage 时用 char/4 估）
      if (tokensUsed === 0 && accumulatedContentLength > 0) {
        const estimatedCompletionTokens = Math.ceil(
          accumulatedContentLength / 4,
        );
        const estimatedPromptTokens = Math.ceil(
          request.messages.reduce((sum, m) => sum + m.content.length, 0) / 4,
        );
        tokensUsed = estimatedCompletionTokens + estimatedPromptTokens;
      }

      // 计费在 finally：success / catch 中 yield error / 消费方 break/throw 全覆盖。
      // 只在实际有内容生成时计费（防 circuit breaker 空跑被错误扣费）。
      if (tokensUsed > 0 || accumulatedContentLength > 0) {
        try {
          await this.handleBilling(
            request,
            streamApiKeySource,
            tokensUsed,
            request.model || "unknown",
          );
        } catch (billingErr) {
          this.logger.warn(
            `[chatStream] handleBilling in finally failed: ${
              billingErr instanceof Error
                ? billingErr.message
                : String(billingErr)
            }`,
          );
        }
      }

      this.orchestration?.circuitBreaker?.decrementLoad(entityId);
    }
  }

  // ==================== Structured Output ====================

  async chatStructured<T>(
    request: StructuredChatRequest,
  ): Promise<StructuredChatResponse<T>> {
    const maxRetries = request.maxRetries ?? 1;
    const throwOnParseError = request.throwOnParseError ?? true;

    const schemaInstruction = [
      "You MUST respond with ONLY valid JSON matching this schema:",
      "```json",
      JSON.stringify(request.schema, null, 2),
      "```",
      "No markdown fences, no extra text, no explanation. ONLY the JSON object.",
    ].join("\n");

    const systemPrompt = request.systemPrompt
      ? `${request.systemPrompt}\n\n${schemaInstruction}`
      : schemaInstruction;

    let lastError: Error | undefined;
    let totalTokens = 0;
    let lastModel = "";
    let lastRawContent = "";

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const chatRequest: ChatRequest = {
        ...request,
        systemPrompt:
          attempt > 0
            ? `${systemPrompt}\n\nYour previous response was not valid JSON. Return ONLY the JSON object.`
            : systemPrompt,
        taskProfile: request.taskProfile || {
          creativity: "deterministic",
          outputLength: "medium",
        },
        strictMode: request.strictMode ?? false,
        // Pass schema for native structured output (supported providers use it)
        outputSchema: {
          type: "json_schema",
          schema: request.schema as unknown as Record<string, unknown>,
        },
      };

      const response = await this.chat(chatRequest);
      totalTokens += response.tokensUsed;
      lastModel = response.model;
      lastRawContent = response.content;

      if (response.isError) {
        lastError = new Error(response.content);
        // ★ Rate limit: 从 content 中提取等待时间，await 后再重试
        const rateLimitMatch = response.content.match(
          /Rate limit exceeded.*?(\d+)\s*seconds/i,
        );
        if (rateLimitMatch && attempt < maxRetries) {
          const waitMs = Math.min(
            parseInt(rateLimitMatch[1], 10) * 1000,
            10_000,
          );
          this.logger.warn(
            `[chatStructured] Rate limited, waiting ${waitMs}ms before retry (attempt ${attempt + 1}/${maxRetries + 1})`,
          );
          await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
        continue;
      }

      try {
        const cleaned = this.extractJson(response.content);
        const parsed = JSON.parse(cleaned) as T;

        return {
          data: parsed,
          rawContent: response.content,
          model: response.model,
          tokensUsed: totalTokens,
          retriedParse: attempt > 0,
        };
      } catch (parseError) {
        lastError =
          parseError instanceof Error
            ? parseError
            : new Error(String(parseError));
        this.logger.warn(
          `[chatStructured] JSON parse failed (attempt ${attempt + 1}/${maxRetries + 1}): ${lastError.message}`,
        );
      }
    }

    if (throwOnParseError) {
      throw new Error(
        `Structured output parse failed after ${maxRetries + 1} attempts: ${lastError?.message}`,
      );
    }

    return {
      data: {} as T,
      rawContent: lastRawContent,
      model: lastModel,
      tokensUsed: totalTokens,
      retriedParse: true,
    };
  }

  private extractJson(content: string): string {
    let cleaned = content.trim();

    const jsonBlockMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
    if (jsonBlockMatch) {
      cleaned = jsonBlockMatch[1].trim();
    }

    const firstBrace = cleaned.indexOf("{");
    const firstBracket = cleaned.indexOf("[");
    const start = Math.min(
      firstBrace >= 0 ? firstBrace : Infinity,
      firstBracket >= 0 ? firstBracket : Infinity,
    );

    if (start !== Infinity && start > 0) {
      cleaned = cleaned.substring(start);
    }

    const lastBrace = cleaned.lastIndexOf("}");
    const lastBracket = cleaned.lastIndexOf("]");
    const end = Math.max(lastBrace, lastBracket);

    if (end >= 0 && end < cleaned.length - 1) {
      cleaned = cleaned.substring(0, end + 1);
    }

    return cleaned;
  }

  // ==================== Billing ====================

  /**
   * Pre-check: reject early when user has zero credits (avoid wasting LLM calls)
   * Only blocks when balance <= 0; low-balance users can still proceed.
   */
  private async preCheckCredits(
    request: ChatRequest,
  ): Promise<ChatResponse | null> {
    if (!this.creditsService) return null;

    const billing = request.billing ?? this.resolveBillingFromContext();
    if (!billing) return null;

    const userId = billing.userId;

    // Fast path: check in-memory cache to avoid DB roundtrip for known zero-balance users
    const cachedExpiry = zeroBalanceCache.get(userId);
    if (cachedExpiry && Date.now() < cachedExpiry) {
      return {
        content:
          "Insufficient credits. Please top up your account to continue.",
        model: "",
        tokensUsed: 0,
        isError: true,
      };
    }

    try {
      const { balance } = await this.creditsService.getBalance(userId);
      if (balance <= 0) {
        // Cache this result to suppress repeated DB lookups and log spam
        zeroBalanceCache.set(userId, Date.now() + ZERO_BALANCE_CACHE_TTL);
        this.logger.warn(
          `[chat] Blocked: user ${userId} has no credits (balance=${balance}), cached for ${ZERO_BALANCE_CACHE_TTL / 1000}s`,
        );
        return {
          content:
            "Insufficient credits. Please top up your account to continue.",
          model: "",
          tokensUsed: 0,
          isError: true,
        };
      } else {
        // User topped up — clear cache
        zeroBalanceCache.delete(userId);
      }
    } catch {
      // If balance check fails, allow the request through (fail-open)
    }
    return null;
  }

  private resolveBillingFromContext(): CreditBillingInfo | undefined {
    const ctx = BillingContext.get();
    if (ctx) {
      return {
        userId: ctx.userId,
        moduleType: ctx.moduleType,
        operationType: ctx.operationType,
        referenceId: ctx.referenceId,
        description: ctx.description,
      };
    }

    const userId = RequestContext.getUserId();
    if (!userId) return undefined;
    this.logger.warn(
      `[Billing] Fallback billing context used — caller did not set BillingContext. userId=${userId}`,
    );
    return {
      userId,
      moduleType: "ai-ask",
      operationType: "chat",
    };
  }

  private async handleBilling(
    request: ChatRequest,
    apiKeySource: string | undefined,
    tokensUsed: number,
    modelName: string,
    tokenDetails?: {
      inputTokens?: number;
      outputTokens?: number;
      cacheCreationTokens?: number;
      cacheReadTokens?: number;
    },
  ): Promise<void> {
    if (apiKeySource === "personal") {
      this.logger.debug(`[Billing] Skipped: user is using personal API key`);
      return;
    }
    const billing = request.billing ?? this.resolveBillingFromContext();
    if (!billing || !this.creditsService) return;
    try {
      await this.creditsService.consumeCredits({
        userId: billing.userId,
        moduleType: billing.moduleType,
        operationType: billing.operationType,
        tokenCount: tokensUsed,
        inputTokens: tokenDetails?.inputTokens,
        outputTokens: tokenDetails?.outputTokens,
        cacheCreationTokens: tokenDetails?.cacheCreationTokens,
        cacheReadTokens: tokenDetails?.cacheReadTokens,
        modelName,
        referenceId: billing.referenceId,
        description: billing.description,
      });
    } catch (creditError) {
      if (creditError instanceof InsufficientCreditsException) {
        // Cache zero balance to suppress further LLM calls for this user
        zeroBalanceCache.set(
          billing.userId,
          Date.now() + ZERO_BALANCE_CACHE_TTL,
        );
        this.logger.error(
          `[Billing] Insufficient credits for user ${billing.userId}: ${creditError.message}`,
        );
      } else {
        this.logger.warn(`[Billing] Failed to deduct credits: ${creditError}`);
      }
    }
  }

  // ==================== Constraint Checking ====================

  /**
   * Validates content against constraints (token limits, sensitive patterns, JSON schema).
   */
  checkConstraints(request: {
    content: string;
    constraints: ConstraintConfig;
  }): ConstraintResult {
    this.logger.debug(
      `[checkConstraints] contentLength=${request.content.length}`,
    );

    const violations: Array<{
      type: "token_limit" | "content_filter" | "json_schema";
      message: string;
    }> = [];

    if (request.constraints.maxTokens) {
      const estimatedTokens = this.estimateTokens(request.content);
      if (estimatedTokens > request.constraints.maxTokens) {
        violations.push({
          type: "token_limit",
          message: `Content exceeds token limit: ${estimatedTokens} > ${request.constraints.maxTokens}`,
        });
      }
    }

    if (request.constraints.contentFilter?.enabled) {
      for (const pattern of SENSITIVE_PATTERNS) {
        if (pattern.test(request.content)) {
          violations.push({
            type: "content_filter",
            message: `Content contains potentially sensitive information matching pattern: ${pattern.source}`,
          });
        }
      }

      if (request.constraints.contentFilter.rules) {
        for (const rule of request.constraints.contentFilter.rules) {
          try {
            const regex = new RegExp(rule, "gi");
            if (regex.test(request.content)) {
              violations.push({
                type: "content_filter",
                message: `Content matches custom filter rule: ${rule}`,
              });
            }
          } catch {
            this.logger.warn(`Invalid regex rule: ${rule}`);
          }
        }
      }
    }

    if (request.constraints.jsonSchema) {
      try {
        const parsed = JSON.parse(request.content);
        const schemaValid = this.validateJsonSchema(
          parsed,
          request.constraints.jsonSchema,
        );
        if (!schemaValid) {
          violations.push({
            type: "json_schema",
            message: "Content does not match the required JSON schema",
          });
        }
      } catch {
        violations.push({
          type: "json_schema",
          message: "Content is not valid JSON",
        });
      }
    }

    let adjustedContent: string | undefined;
    if (violations.some((v) => v.type === "token_limit")) {
      adjustedContent = this.compressContext(
        request.content,
        request.constraints.maxTokens || 4000,
      );
    }

    return {
      passed: violations.length === 0,
      violations: violations.length > 0 ? violations : undefined,
      adjustedContent,
    };
  }

  private estimateTokens(text: string): number {
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const otherChars = text.length - chineseChars;
    return Math.ceil(chineseChars * 2 + otherChars / 4);
  }

  private compressContext(context: string, maxTokens: number): string {
    const currentTokens = this.estimateTokens(context);
    if (currentTokens <= maxTokens) {
      return context;
    }

    const ratio = maxTokens / currentTokens;
    const targetLength = Math.floor(context.length * ratio * 0.9);

    const headLength = Math.floor(targetLength * 0.6);
    const tailLength = Math.floor(targetLength * 0.3);

    const head = context.substring(0, headLength);
    const tail = context.substring(context.length - tailLength);

    return `${head}\n\n[... content compressed ...]\n\n${tail}`;
  }

  private validateJsonSchema(data: unknown, schema: object): boolean {
    const schemaObj = schema as {
      type?: string;
      required?: string[];
      properties?: Record<string, { type?: string }>;
    };

    if (schemaObj.type === "object" && typeof data !== "object") {
      return false;
    }
    if (schemaObj.type === "array" && !Array.isArray(data)) {
      return false;
    }

    if (
      schemaObj.required &&
      typeof data === "object" &&
      data !== null &&
      !Array.isArray(data)
    ) {
      const obj = data as Record<string, unknown>;
      for (const field of schemaObj.required) {
        if (!(field in obj)) {
          return false;
        }
      }
    }

    return true;
  }

  // ==================== Helpers ====================

  /**
   * Extract query string from the last user message for description-based skill matching.
   */
  private extractQueryFromMessages(
    messages: Array<{ role: string; content: string }>,
  ): string {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user" && messages[i].content) {
        // Take first 200 chars as query (enough for keyword matching)
        return messages[i].content.slice(0, 200);
      }
    }
    return "";
  }

  // ==================== Service Getters ====================

  /** ModelFallbackService for direct model fallback chain access */
  get modelFallback(): ModelFallbackService | undefined {
    return this.modelFallbackService;
  }

  // ==================== Model Selection & Config ====================

  async selectModel(
    options: ModelSelectionOptions = {},
  ): Promise<ModelInfo | null> {
    return this.modelSub.selectModel(options);
  }

  async getReasoningModel(): Promise<ModelInfo | null> {
    return this.modelSub.getReasoningModel();
  }

  async getAvailableModelsExtended(
    modelType: AIModelType = AIModelType.CHAT,
  ): Promise<ModelInfo[]> {
    return this.modelSub.getAvailableModelsExtended(modelType);
  }

  async getAvailableModels(modelType: AIModelType = AIModelType.CHAT): Promise<
    Array<{
      id: string;
      dbId?: string;
      name: string;
      provider: string;
      icon?: string | null;
      isDefault?: boolean;
    }>
  > {
    return this.modelSub.getAvailableModels(modelType);
  }

  async getDefaultTextModel(): Promise<{
    id: string;
    modelId: string;
    displayName: string;
    provider: string;
    maxTokens?: number;
  } | null> {
    return this.modelSub.getDefaultTextModel();
  }

  async getDefaultImageModel(): Promise<{
    id: string;
    modelId: string;
    displayName: string;
    provider: string;
    maxTokens?: number;
  } | null> {
    return this.modelSub.getDefaultImageModel();
  }

  async getModelById(idOrModelId: string): Promise<{
    id: string;
    modelId: string;
    displayName: string;
    provider: string;
    maxTokens?: number;
    apiEndpoint?: string;
    isReasoning?: boolean;
    apiKey?: string | null;
    secretKey?: string | null;
    modelType?: string;
  } | null> {
    return this.modelSub.getModelById(idOrModelId);
  }

  async getFullModelConfig(modelId: string): Promise<{
    id: string;
    modelId: string;
    displayName: string;
    name: string;
    provider: string;
    apiKey: string;
    secretKey?: string | null;
    apiEndpoint?: string | null;
    maxTokens?: number | null;
    temperature?: number | null;
    isEnabled: boolean;
    isDefault: boolean;
    isReasoning?: boolean;
    apiFormat?: string | null;
    supportsTemperature?: boolean;
    supportsStreaming?: boolean;
    supportsFunctionCalling?: boolean;
    supportsVision?: boolean;
    tokenParamName?: string | null;
    defaultTimeoutMs?: number | null;
    priceInputPerMillion?: number | null;
    priceOutputPerMillion?: number | null;
    priority?: number | null;
  } | null> {
    return this.modelSub.getFullModelConfig(modelId);
  }

  async getDefaultModelByType(modelType: AIModelType): Promise<{
    id: string;
    modelId: string;
    displayName: string;
    provider: string;
    maxTokens?: number;
  } | null> {
    return this.modelSub.getDefaultModelByType(modelType);
  }

  // ==================== Admin: Model Management ====================

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
    this.logger.log(
      `[fetchAvailableModels] provider=${provider}, modelType=${modelType}`,
    );
    return this.aiChatService.fetchAvailableModels(
      provider,
      apiKey,
      apiEndpoint,
      modelType,
    );
  }

  async testModelConnectionWithKey(
    provider: string,
    modelId: string,
    apiKey: string,
    apiEndpoint: string,
    modelType?: string,
  ): Promise<{ success: boolean; message: string; latency?: number }> {
    this.logger.log(
      `[testModelConnectionWithKey] provider=${provider}, modelId=${modelId}`,
    );
    return this.aiChatService.testModelConnectionWithKey(
      provider,
      modelId,
      apiKey,
      apiEndpoint,
      modelType,
    );
  }
}
