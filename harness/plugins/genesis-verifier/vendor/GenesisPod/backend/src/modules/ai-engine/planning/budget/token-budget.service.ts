/**
 * AI Engine - Token Budget Service
 * AI 引擎 Token 预算管理服务
 *
 * 从 AI Teams 下沉的核心能力：
 * - 动态计算可用 token 预算
 * - 按优先级分配预算
 * - 超预算时智能压缩
 */

import { Injectable, Logger } from "@nestjs/common";

/**
 * 模型配置
 */
export interface ModelConfig {
  modelId: string;
  contextWindow: number;
  maxOutputTokens: number;
  provider: string;
}

/**
 * Token 预算
 */
export interface TokenBudget {
  total: number; // 模型上下文窗口
  maxOutput: number; // 预留给输出
  system: number; // 系统提示
  mustConstraints: number; // 硬约束（不可压缩）
  available: number; // 可分配给其他内容
}

/**
 * 内容优先级
 */
export interface ContentPriority {
  key: string;
  priority: number; // 数字越小优先级越高
  content: string;
  compressible: boolean;
  minTokens?: number; // 压缩后的最小 token 数
}

/**
 * 预算分配结果
 */
export interface BudgetAllocation {
  systemPrompt: string;
  mustConstraints: string;
  allocatedContent: Map<string, string>;
  totalTokens: number;
  withinBudget: boolean;
  compressionApplied: boolean;
}

/**
 * 已知模型的上下文窗口配置
 */
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  // OpenAI
  "gpt-4o": 128000,
  "gpt-4o-mini": 128000,
  "gpt-4-turbo": 128000,
  "gpt-4-turbo-preview": 128000,
  "gpt-4": 8192,
  "gpt-4-32k": 32768,
  "gpt-3.5-turbo": 16385,
  // OpenAI o1/o3 reasoning models
  o1: 200000,
  "o1-preview": 128000,
  "o1-mini": 128000,
  "o3-mini": 200000,
  // GPT-5 系列
  "gpt-5": 256000,
  "gpt-5.1": 256000,
  "gpt-5.1-chat-latest": 256000,
  "gpt-5.2": 400000,
  "gpt-5-mini": 128000,

  // Anthropic
  "claude-3-5-sonnet-20241022": 200000,
  "claude-3-5-haiku-20241022": 200000,
  "claude-3-opus-20240229": 200000,
  "claude-3-sonnet-20240229": 200000,
  "claude-3-haiku-20240307": 200000,
  "claude-opus-4-5-20251101": 200000,
  "claude-sonnet-4-20250514": 200000,

  // Google
  "gemini-1.5-pro": 2000000,
  "gemini-1.5-flash": 1000000,
  "gemini-2.0-flash-exp": 1000000,
  "gemini-3-flash-preview": 1000000,

  // xAI
  "grok-beta": 131072,
  "grok-3": 131072,

  // DeepSeek
  "deepseek-chat": 64000,
  "deepseek-reasoner": 64000,
};

/**
 * 默认模型输出 token 限制
 */
const MODEL_MAX_OUTPUT: Record<string, number> = {
  // OpenAI
  "gpt-4o": 16384,
  "gpt-4o-mini": 16384,
  "gpt-4-turbo": 4096,
  "gpt-4-turbo-preview": 4096,
  o1: 100000,
  "o1-preview": 32768,
  "o1-mini": 65536,
  "o3-mini": 100000,
  // GPT-5 系列 - 128K max output
  "gpt-5": 128000,
  "gpt-5.1": 128000,
  "gpt-5.1-chat-latest": 128000,
  "gpt-5.2": 128000,
  "gpt-5-mini": 32768,
  // Anthropic
  "claude-3-5-sonnet-20241022": 8192,
  "claude-3-5-haiku-20241022": 8192,
  "claude-opus-4-5-20251101": 16384,
  "claude-sonnet-4-20250514": 16384,
  // Google
  "gemini-1.5-pro": 8192,
  "gemini-2.0-flash-exp": 8192,
  "gemini-3-flash-preview": 8192,
  default: 4096,
};

/**
 * v3.1 §D.2.2 (2026-05-24)：modelId → provider 启发式（启发式 fallback；最后兜底）。
 *
 * **显式 fallback 警告**：
 *   - 调用方若手里有 `AIModelConfig.provider`（DB 来源），必须先传入：
 *     `tokenBudget.getModelConfig(modelId, config.provider)`
 *   - 直接调本启发式仅限于：调用方只有 modelId 字符串、无 DB 上下文的场景。
 *
 * o-series 用正则覆盖未来型号（o4/o5/...）。未匹配返回空串（caller 看作 unknown）。
 */
export function inferProviderFromModelId(modelId: string): string {
  if (modelId.startsWith("gpt") || /^o\d/.test(modelId)) return "openai";
  if (modelId.startsWith("claude")) return "anthropic";
  if (modelId.startsWith("gemini")) return "google";
  if (modelId.startsWith("grok")) return "xai";
  if (modelId.startsWith("deepseek")) return "deepseek";
  return "";
}

@Injectable()
export class ContextBudgetCalculator {
  private readonly logger = new Logger(ContextBudgetCalculator.name);

  // 简单的 token 计算（中文约 1.5 token/字符，英文约 0.25 token/字符）
  private readonly AVG_TOKENS_PER_CHAR_ZH = 1.5;
  private readonly AVG_TOKENS_PER_CHAR_EN = 0.25;

  /**
   * 估算文本的 token 数量
   */
  countTokens(text: string): number {
    // 严格检查空值和空字符串，防止除零
    if (!text || typeof text !== "string" || text.length === 0) {
      return 0;
    }

    // 简单估算：检测中英文比例
    const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const totalChars = text.length;
    const chineseRatio = chineseChars / totalChars;

    // 加权计算
    const avgTokensPerChar =
      chineseRatio * this.AVG_TOKENS_PER_CHAR_ZH +
      (1 - chineseRatio) * this.AVG_TOKENS_PER_CHAR_EN;

    return Math.ceil(totalChars * avgTokensPerChar);
  }

  /**
   * 获取模型配置
   *
   * @param modelId 模型 id（用于查 context window / max output 静态表）
   * @param providerHint 调用方手里有 DB AIModelConfig.provider 时显式传入
   *                     （v3.1 §D.2.2 显式 fallback：DB ?? 启发式）。
   *                     缺失时落到 modelId 启发式（兜底语义不变）。
   *
   * **不要在新代码里只传 modelId**：当上游已经从 DB 取到了 AIModelConfig，
   * 必须把 `config.provider` 透传过来，避免本服务的 startsWith 启发式
   * 覆盖管理员在 DB 设的 provider 真值（例如多 endpoint 同名模型）。
   */
  getModelConfig(modelId: string, providerHint?: string): ModelConfig {
    const contextWindow =
      MODEL_CONTEXT_WINDOWS[modelId] ||
      MODEL_CONTEXT_WINDOWS["gpt-4o-mini"] ||
      128000;

    const maxOutputTokens =
      MODEL_MAX_OUTPUT[modelId] || MODEL_MAX_OUTPUT["default"];

    // v3.1 §D.2.2 显式 fallback：DB provider 优先；缺失才走 modelId 启发式
    const provider =
      (providerHint && providerHint.trim().length > 0
        ? providerHint
        : inferProviderFromModelId(modelId)) || "unknown";

    return {
      modelId,
      contextWindow,
      maxOutputTokens,
      provider,
    };
  }

  /**
   * 计算可用预算
   */
  calculateBudget(modelId: string, systemPromptTokens?: number): TokenBudget {
    const config = this.getModelConfig(modelId);

    const system = systemPromptTokens || 2000; // 系统提示预留
    const buffer = 1000; // 安全缓冲

    const available =
      config.contextWindow - config.maxOutputTokens - system - buffer;

    return {
      total: config.contextWindow,
      maxOutput: config.maxOutputTokens,
      system,
      mustConstraints: 0, // 动态计算
      available: Math.max(0, available),
    };
  }

  /**
   * 按优先级分配预算
   */
  allocateBudget(
    budget: TokenBudget,
    priorities: ContentPriority[],
  ): BudgetAllocation {
    // 按优先级排序
    const sorted = [...priorities].sort((a, b) => a.priority - b.priority);

    let remainingBudget = budget.available;
    const allocatedContent = new Map<string, string>();
    let compressionApplied = false;

    for (const item of sorted) {
      const tokens = this.countTokens(item.content);

      if (tokens <= remainingBudget) {
        // 完整分配
        allocatedContent.set(item.key, item.content);
        remainingBudget -= tokens;
      } else if (item.compressible && remainingBudget > 0) {
        // 需要压缩
        const compressed = this.compress(item.content, remainingBudget);
        allocatedContent.set(item.key, compressed);
        remainingBudget -= this.countTokens(compressed);
        compressionApplied = true;
        this.logger.debug(
          `[allocateBudget] Compressed "${item.key}": ${tokens} -> ${this.countTokens(compressed)} tokens`,
        );
      } else {
        // 跳过
        this.logger.warn(
          `[allocateBudget] Skipping "${item.key}" due to budget constraints (need ${tokens}, have ${remainingBudget})`,
        );
      }
    }

    const totalAllocated = budget.available - remainingBudget;

    return {
      systemPrompt: "", // 调用者提供
      mustConstraints: "", // 调用者提供
      allocatedContent,
      totalTokens: totalAllocated,
      withinBudget: remainingBudget >= 0,
      compressionApplied,
    };
  }

  /**
   * 压缩文本到指定 token 预算
   */
  compress(content: string, targetTokens: number): string {
    // 防御性检查：空内容直接返回
    if (!content || content.length === 0) {
      return content;
    }

    const currentTokens = this.countTokens(content);

    if (currentTokens <= targetTokens) {
      return content;
    }

    // 计算需要保留的字符数（估算）
    const chineseChars = (content.match(/[\u4e00-\u9fff]/g) || []).length;
    const totalChars = content.length;
    const chineseRatio = chineseChars / totalChars;
    const avgTokensPerChar =
      chineseRatio * this.AVG_TOKENS_PER_CHAR_ZH +
      (1 - chineseRatio) * this.AVG_TOKENS_PER_CHAR_EN;

    const targetChars = Math.floor(targetTokens / avgTokensPerChar);

    // 使用首尾截取策略
    if (targetChars >= content.length) {
      return content;
    }

    const headLength = Math.floor(targetChars * 0.65); // 开头保留 65%
    const tailLength = targetChars - headLength - 50; // 结尾保留剩余部分，减去省略提示

    if (tailLength <= 0) {
      return content.substring(0, targetChars) + "...";
    }

    const head = content.substring(0, headLength);
    const tail = content.substring(content.length - tailLength);

    return `${head}\n\n...[内容已压缩，原文${content.length}字符]...\n\n${tail}`;
  }

  /**
   * 智能截断（保留首尾和关键段落）
   */
  smartTruncate(
    content: string,
    maxTokens: number,
    options?: {
      preserveHead?: number; // 保留开头的 token 比例
      preserveTail?: number; // 保留结尾的 token 比例
    },
  ): string {
    // 防御性检查：空内容直接返回
    if (!content || content.length === 0) {
      return content;
    }

    const currentTokens = this.countTokens(content);

    if (currentTokens <= maxTokens) {
      return content;
    }

    const headRatio = options?.preserveHead ?? 0.6;
    const tailRatio = options?.preserveTail ?? 0.3;
    const reservedForMarker = 50; // 省略标记

    const headTokens = Math.floor((maxTokens - reservedForMarker) * headRatio);
    const tailTokens = Math.floor((maxTokens - reservedForMarker) * tailRatio);

    // 转换为字符数
    const chineseRatio =
      (content.match(/[\u4e00-\u9fff]/g) || []).length / content.length;
    const avgTokensPerChar =
      chineseRatio * this.AVG_TOKENS_PER_CHAR_ZH +
      (1 - chineseRatio) * this.AVG_TOKENS_PER_CHAR_EN;

    const headChars = Math.floor(headTokens / avgTokensPerChar);
    const tailChars = Math.floor(tailTokens / avgTokensPerChar);

    const head = content.substring(0, headChars);
    const tail = content.substring(content.length - tailChars);

    const omittedChars = content.length - headChars - tailChars;

    return `${head}\n\n...[已省略 ${omittedChars} 字符]...\n\n${tail}`;
  }

  /**
   * 检查内容是否需要压缩
   */
  needsCompression(content: string, budget: TokenBudget): boolean {
    return this.countTokens(content) > budget.available;
  }

  /**
   * 推荐适合的模型（根据内容大小）
   */
  recommendModel(contentTokens: number, currentModel: string): string {
    const currentConfig = this.getModelConfig(currentModel);

    // 如果当前模型足够，不需要切换
    if (contentTokens < currentConfig.contextWindow * 0.8) {
      return currentModel;
    }

    // 按上下文窗口大小排序的模型列表
    const modelsByContext = Object.entries(MODEL_CONTEXT_WINDOWS)
      .sort(([, a], [, b]) => b - a)
      .map(([model]) => model);

    // 找到第一个足够大的模型
    for (const model of modelsByContext) {
      const config = this.getModelConfig(model);
      if (contentTokens < config.contextWindow * 0.8) {
        // 优先选择同一 provider 的模型
        if (
          config.provider === currentConfig.provider ||
          model === currentModel
        ) {
          return model;
        }
      }
    }

    // 如果都不够大，返回最大的模型
    return modelsByContext[0] || currentModel;
  }

  /**
   * Count actual tokens from an LLM response (uses real API-reported values).
   * Falls back to character-based estimation if response lacks token data.
   */
  countTokensFromResponse(response: {
    inputTokens?: number;
    outputTokens?: number;
    tokensUsed?: number;
    content?: string;
  }): number {
    // Prefer actual API-reported tokens
    if (response.inputTokens && response.outputTokens) {
      return response.inputTokens + response.outputTokens;
    }
    if (response.tokensUsed && response.tokensUsed > 0) {
      return response.tokensUsed;
    }
    // Fallback to character estimation
    if (response.content) {
      return this.countTokens(response.content);
    }
    return 0;
  }

  /**
   * 格式化预算报告
   */
  formatBudgetReport(budget: TokenBudget, used: number): string {
    const utilization = ((used / budget.available) * 100).toFixed(1);
    const remaining = budget.available - used;

    return (
      `Token Budget Report:\n` +
      `  Total Context: ${budget.total.toLocaleString()} tokens\n` +
      `  Max Output: ${budget.maxOutput.toLocaleString()} tokens\n` +
      `  System Reserved: ${budget.system.toLocaleString()} tokens\n` +
      `  Available: ${budget.available.toLocaleString()} tokens\n` +
      `  Used: ${used.toLocaleString()} tokens (${utilization}%)\n` +
      `  Remaining: ${remaining.toLocaleString()} tokens`
    );
  }
}
