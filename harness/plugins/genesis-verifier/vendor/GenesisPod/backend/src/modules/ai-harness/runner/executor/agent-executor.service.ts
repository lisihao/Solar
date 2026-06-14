/**
 * Agent Executor Service
 * Agent 执行服务 - AI Engine 核心能力
 *
 * 从 AI Teams 的 MissionExecutionService 下沉到 AI Engine
 * 提供通用的 Agent 任务执行能力
 */

import { Injectable, Logger } from "@nestjs/common";
import {
  IAgentExecutorService,
  ExecutionContext,
  ExecutionConfig,
  ExecutionResult,
} from "../../../ai-harness/runner/executor/executor.types";
import { AiChatService } from "../../../ai-engine/llm/chat/ai-chat.service";
// ★ 架构重构：通过 ToolRegistry 调用工具
import { ToolRegistry } from "../../../ai-engine/tools/registry/tool.registry";
import type { ToolContext } from "../../../ai-engine/tools/abstractions/tool.interface";
import { PrismaService } from "../../../../common/prisma/prisma.service";

/**
 * 熔断器状态
 */
interface CircuitBreakerState {
  /** Agent ID */
  agentId: string;
  /** 连续失败次数 */
  failureCount: number;
  /** 最后失败时间 */
  lastFailureTime: Date | null;
  /** 是否处于打开状态（熔断） */
  isOpen: boolean;
  /** 半开状态下的尝试次数 */
  halfOpenAttempts: number;
}

/**
 * 默认执行配置
 */
const DEFAULT_CONFIG: ExecutionConfig = {
  taskProfile: {
    creativity: "medium",
    outputLength: "medium",
  },
  enableSearch: false,
  maxRetries: 3,
  retryInitialDelay: 1000,
  timeout: 120000,
};

/**
 * 熔断器配置
 */
const CIRCUIT_BREAKER_CONFIG = {
  /** 触发熔断的失败次数 */
  failureThreshold: 3,
  /** 熔断持续时间（毫秒） */
  openDuration: 60000,
  /** 半开状态最大尝试次数 */
  halfOpenMaxAttempts: 2,
};

@Injectable()
export class AgentExecutorService implements IAgentExecutorService {
  private readonly logger = new Logger(AgentExecutorService.name);
  private readonly circuitBreakers = new Map<string, CircuitBreakerState>();

  constructor(
    private readonly aiChatService: AiChatService,
    // ★ 架构重构：通过 ToolRegistry 调用工具
    private readonly toolRegistry: ToolRegistry,
    private readonly prismaService: PrismaService,
  ) {}

  /**
   * 创建工具执行上下文
   */
  private createToolContext(toolId: string): ToolContext {
    return {
      executionId: `${toolId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      toolId,
      createdAt: new Date(),
      callerType: "orchestrator",
    };
  }

  /**
   * 执行单个任务
   */
  async executeTask(
    context: ExecutionContext,
    config?: ExecutionConfig,
  ): Promise<ExecutionResult> {
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };
    const startTime = Date.now();

    // 检查熔断器状态
    if (!this.isAgentAvailable(context.executor.id)) {
      return {
        success: false,
        content: "",
        tokensUsed: 0,
        duration: Date.now() - startTime,
        error: `Agent ${context.executor.agentName || context.executor.id} is temporarily unavailable (circuit breaker open)`,
        retryable: true,
      };
    }

    try {
      // 搜索增强（如果启用）
      let searchContext = context.searchContext || "";
      let searchResults:
        | Array<{ title: string; url: string; snippet: string }>
        | undefined;

      if (
        mergedConfig.enableSearch &&
        this.needsWebSearch(context.userPrompt)
      ) {
        try {
          const searchQuery = this.buildSearchQuery(context.userPrompt);
          this.logger.debug(
            `[executeTask] Performing search: "${searchQuery}"`,
          );

          // ★ 通过 ToolRegistry 调用 web-search 工具
          const webSearchTool = this.toolRegistry.tryGet("web-search");
          if (webSearchTool) {
            const toolResult = await webSearchTool.execute(
              { query: searchQuery, numResults: 10 },
              this.createToolContext("web-search"),
            );
            if (toolResult.success && toolResult.data) {
              const searchData = toolResult.data as {
                results: Array<{ title: string; url: string; content: string }>;
                success: boolean;
              };
              if (searchData.success && searchData.results?.length > 0) {
                searchContext = this.formatSearchResults(searchData.results);
                searchResults = searchData.results.map((r) => ({
                  title: r.title,
                  url: r.url,
                  snippet: r.content || "",
                }));
              }
            }
          }
        } catch (error) {
          this.logger.warn(
            `[executeTask] Search failed: ${(error as Error).message}`,
          );
        }
      }

      // 构建消息
      const messages = [
        {
          role: "user" as const,
          content: searchContext
            ? `${context.userPrompt}\n\n【搜索结果参考】\n${searchContext}`
            : context.userPrompt,
        },
      ];

      // 获取模型配置
      const modelConfig = await this.getModelConfig(context.executor.aiModel);

      // 执行 AI 调用（带重试）
      let lastError: Error | null = null;
      let retryCount = 0;

      while (retryCount <= (mergedConfig.maxRetries || 0)) {
        try {
          const result = await this.callAIWithConfig(
            context.executor.aiModel,
            messages,
            context.systemPrompt,
            {
              maxTokens: mergedConfig.maxTokens,
              taskProfile: mergedConfig.taskProfile,
              missionId: context.missionId,
            },
            modelConfig,
          );

          // 记录成功
          this.recordExecution(
            context.executor.id,
            true,
            Date.now() - startTime,
          );

          return {
            success: true,
            content: result.content,
            tokensUsed: result.tokensUsed,
            duration: Date.now() - startTime,
            searchResults,
          };
        } catch (error) {
          lastError = error as Error;

          if (this.isRetryableError(error)) {
            retryCount++;
            if (retryCount <= (mergedConfig.maxRetries || 0)) {
              const delay =
                (mergedConfig.retryInitialDelay || 1000) *
                Math.pow(2, retryCount - 1);
              this.logger.warn(
                `[executeTask] Retry ${retryCount}/${mergedConfig.maxRetries} after ${delay}ms: ${(error as Error).message}`,
              );
              await this.sleep(delay);
            }
          } else {
            break;
          }
        }
      }

      // 记录失败
      this.recordExecution(context.executor.id, false, Date.now() - startTime);

      return {
        success: false,
        content: "",
        tokensUsed: 0,
        duration: Date.now() - startTime,
        error: lastError?.message || "Unknown error",
        retryable: this.isRetryableError(lastError),
      };
    } catch (error) {
      this.recordExecution(context.executor.id, false, Date.now() - startTime);

      return {
        success: false,
        content: "",
        tokensUsed: 0,
        duration: Date.now() - startTime,
        error: (error as Error).message,
        retryable: false,
      };
    }
  }

  /**
   * 批量执行任务（并发控制）
   */
  async executeTasks(
    contexts: ExecutionContext[],
    config?: ExecutionConfig & { concurrency?: number },
  ): Promise<ExecutionResult[]> {
    const concurrency = config?.concurrency || 3;

    // 使用并发控制执行
    const results: ExecutionResult[] = [];
    const queue = [...contexts];

    while (queue.length > 0) {
      const batch = queue.splice(0, concurrency);
      const batchResults = await Promise.all(
        batch.map((ctx) => this.executeTask(ctx, config)),
      );
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * 检查 Agent 是否可用（熔断器状态）
   */
  isAgentAvailable(agentId: string): boolean {
    const state = this.circuitBreakers.get(agentId);
    if (!state) return true;

    if (!state.isOpen) return true;

    // 检查是否应该进入半开状态
    const now = Date.now();
    const timeSinceLastFailure = state.lastFailureTime
      ? now - state.lastFailureTime.getTime()
      : Infinity;

    if (timeSinceLastFailure >= CIRCUIT_BREAKER_CONFIG.openDuration) {
      // 进入半开状态
      if (state.halfOpenAttempts < CIRCUIT_BREAKER_CONFIG.halfOpenMaxAttempts) {
        state.halfOpenAttempts++;
        this.logger.log(
          `[isAgentAvailable] Agent ${agentId} entering half-open state (attempt ${state.halfOpenAttempts})`,
        );
        return true;
      }
    }

    return false;
  }

  /**
   * 记录 Agent 执行结果（用于熔断器）
   */
  recordExecution(agentId: string, success: boolean, duration: number): void {
    let state = this.circuitBreakers.get(agentId);

    if (!state) {
      state = {
        agentId,
        failureCount: 0,
        lastFailureTime: null,
        isOpen: false,
        halfOpenAttempts: 0,
      };
      this.circuitBreakers.set(agentId, state);
    }

    if (success) {
      // 成功：重置状态
      state.failureCount = 0;
      state.isOpen = false;
      state.halfOpenAttempts = 0;
      this.logger.debug(
        `[recordExecution] Agent ${agentId} succeeded in ${duration}ms`,
      );
    } else {
      // 失败：增加计数
      state.failureCount++;
      state.lastFailureTime = new Date();

      if (state.failureCount >= CIRCUIT_BREAKER_CONFIG.failureThreshold) {
        state.isOpen = true;
        this.logger.warn(
          `[recordExecution] Agent ${agentId} circuit breaker OPEN after ${state.failureCount} failures`,
        );
      }
    }
  }

  // ==================== 私有方法 ====================

  /**
   * 获取模型配置
   */
  private async getModelConfig(aiModel: string) {
    try {
      const modelConfig = await this.prismaService.aIModel.findFirst({
        where: {
          OR: [
            { modelId: { equals: aiModel, mode: "insensitive" } },
            { name: { equals: aiModel, mode: "insensitive" } },
          ],
          isEnabled: true,
        },
      });
      return modelConfig;
    } catch {
      return null;
    }
  }

  /**
   * 调用 AI（带数据库 API Key）
   */
  private async callAIWithConfig(
    aiModel: string,
    messages: { role: string; content: string }[],
    systemPrompt: string,
    options: {
      maxTokens?: number;
      taskProfile?: ExecutionConfig["taskProfile"];
      missionId?: string;
    },
    modelConfig?: Awaited<ReturnType<typeof this.getModelConfig>>,
  ): Promise<{ content: string; tokensUsed: number }> {
    // ★ v3.1 C 阶段（2026-05-24）：删启发式 isLargeModel，改 DB 驱动。
    //   AIModel.maxTokens 由 admin 配置，是 capability 单源；阈值
    //   `>= LARGE_MODEL_TOKEN_THRESHOLD`（与原启发式映射的 6000 等价语义）
    //   决定 default。无配置时退回 4000（与原 "非 large" 分支一致）。
    //   替代删除的 `/^gpt-/.test + /^o\d/.test + includes("claude"|"gemini")`
    //   反模式（C.A.1）。
    const LARGE_MODEL_TOKEN_THRESHOLD = 6000;
    const SMALL_MODEL_DEFAULT_MAX_TOKENS = 4000;
    const configMaxTokens =
      typeof modelConfig?.maxTokens === "number" && modelConfig.maxTokens > 0
        ? modelConfig.maxTokens
        : null;
    const defaultMaxTokens =
      configMaxTokens !== null && configMaxTokens >= LARGE_MODEL_TOKEN_THRESHOLD
        ? LARGE_MODEL_TOKEN_THRESHOLD
        : SMALL_MODEL_DEFAULT_MAX_TOKENS;

    // 统一走 generateChatCompletion，由下游通过 Secret Manager 解析 API Key
    const result = await this.aiChatService.generateChatCompletion({
      model: aiModel,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages,
      ] as Array<{ role: "system" | "user" | "assistant"; content: string }>,
      maxTokens: options.maxTokens || defaultMaxTokens,
      taskProfile: options.taskProfile ?? {
        creativity: "medium",
        outputLength: "medium",
      },
    });

    return {
      content: result.content,
      tokensUsed: result.tokensUsed || 0,
    };
  }

  /**
   * 判断是否需要网页搜索
   */
  private needsWebSearch(prompt: string): boolean {
    const searchIndicators = [
      "最新",
      "最近",
      "当前",
      "现在",
      "2024",
      "2025",
      "搜索",
      "查找",
      "市场",
      "行业",
      "趋势",
      "动态",
      "新闻",
      "报告",
      "数据",
      "统计",
      "latest",
      "recent",
      "current",
      "now",
      "search",
      "find",
      "market",
      "industry",
      "trend",
      "news",
      "report",
    ];

    const lowerPrompt = prompt.toLowerCase();
    return searchIndicators.some((indicator) =>
      lowerPrompt.includes(indicator.toLowerCase()),
    );
  }

  /**
   * 构建搜索查询
   */
  private buildSearchQuery(prompt: string): string {
    // 提取关键词
    const cleanPrompt = prompt
      .replace(/[，。！？、\n]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // 限制长度
    if (cleanPrompt.length > 100) {
      return cleanPrompt.substring(0, 100);
    }
    return cleanPrompt;
  }

  /**
   * 格式化搜索结果
   */
  private formatSearchResults(
    results: Array<{ title: string; url: string; snippet?: string }>,
  ): string {
    return results
      .slice(0, 5)
      .map(
        (r, i) =>
          `[${i + 1}] ${r.title}\n   来源: ${r.url}\n   ${r.snippet || ""}`,
      )
      .join("\n\n");
  }

  /**
   * 判断错误是否可重试
   */
  private isRetryableError(error: unknown): boolean {
    if (!error) return false;
    const message = (error as Error).message?.toLowerCase() || "";
    return (
      message.includes("timeout") ||
      message.includes("rate limit") ||
      message.includes("429") ||
      message.includes("503") ||
      message.includes("network") ||
      message.includes("connection")
    );
  }

  /**
   * 延迟
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
