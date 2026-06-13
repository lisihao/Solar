import { Injectable, Logger } from "@nestjs/common";
import { inferIsReasoning } from "../types/model.utils";

interface LlmResponseWithUsage {
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    completion_tokens_details?: {
      reasoning_tokens?: number;
    };
  };
}

/**
 * AI Chat Token Service
 * 职责：Token 计数、成本计算、限制验证
 */
@Injectable()
export class AiChatTokenService {
  private readonly logger = new Logger(AiChatTokenService.name);

  /**
   * 计算消息的大致 token 数量
   * 简单估算：1 token ≈ 4 个字符（英文）或 1.5 个字符（中文）
   */
  estimateTokenCount(text: string): number {
    // 简单估算：中英文混合
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const otherChars = text.length - chineseChars;

    // 中文：1.5 字符/token，英文：4 字符/token
    return Math.ceil(chineseChars / 1.5 + otherChars / 4);
  }

  /**
   * 计算成本（基于 token 使用量）
   */
  calculateCost(
    promptTokens: number,
    completionTokens: number,
    priceInputPerMillion?: number,
    priceOutputPerMillion?: number,
  ): number {
    if (!priceInputPerMillion || !priceOutputPerMillion) {
      return 0;
    }

    const inputCost = (promptTokens / 1_000_000) * priceInputPerMillion;
    const outputCost = (completionTokens / 1_000_000) * priceOutputPerMillion;

    return inputCost + outputCost;
  }

  /**
   * 验证 token 限制
   */
  validateTokenLimit(
    estimatedTokens: number,
    maxTokens: number,
  ): { valid: boolean; reason?: string } {
    if (estimatedTokens > maxTokens) {
      return {
        valid: false,
        reason: `Estimated tokens (${estimatedTokens}) exceeds limit (${maxTokens})`,
      };
    }
    return { valid: true };
  }

  /**
   * 获取推荐的 token 参数名（基于模型类型）。
   *
   * ★ 约束：isReasoning 为 undefined（DB 未显式设置）时按 modelId 启发式兜底，
   *   避免 reasoning 模型（gpt-5.x/o1/o3/o4 等）误发 max_tokens 触发
   *   OpenAI INVALID_REQUEST。显式 boolean（含 false）以传入值为准。
   */
  getTokenParamName(isReasoning?: boolean, modelId?: string): string {
    const effective = isReasoning ?? inferIsReasoning(modelId ?? "");
    return effective ? "max_completion_tokens" : "max_tokens";
  }

  /**
   * 解析 API 响应中的 token 使用量
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw LLM response object; structure varies by provider
  parseTokenUsage(response: LlmResponseWithUsage): {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    reasoningTokens?: number;
  } {
    const usage = response?.usage || {};
    const completionDetails = usage.completion_tokens_details || {};

    return {
      promptTokens: usage.prompt_tokens || 0,
      completionTokens: usage.completion_tokens || 0,
      totalTokens: usage.total_tokens || 0,
      reasoningTokens: completionDetails.reasoning_tokens,
    };
  }

  /**
   * 记录 token 使用情况
   */
  logTokenUsage(
    model: string,
    usage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      reasoningTokens?: number;
    },
    cost?: number,
  ): void {
    const { promptTokens, completionTokens, totalTokens, reasoningTokens } =
      usage;

    let logMessage = `[${model}] Tokens: ${totalTokens} (prompt: ${promptTokens}, completion: ${completionTokens}`;

    if (reasoningTokens) {
      logMessage += `, reasoning: ${reasoningTokens}`;
    }

    if (cost) {
      logMessage += `, cost: $${cost.toFixed(6)}`;
    }

    logMessage += ")";

    this.logger.debug(logMessage);
  }
}
