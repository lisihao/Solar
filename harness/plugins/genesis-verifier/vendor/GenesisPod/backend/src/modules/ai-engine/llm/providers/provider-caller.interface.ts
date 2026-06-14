/**
 * Shared types for the per-provider API caller split.
 *
 * Behavior-preserving extraction (2026-06): these result shapes were previously
 * declared inline in `ai-api-caller.service.ts`. They are surfaced here so the
 * extracted `BaseHttpCaller` and the per-provider callers can share a single
 * definition without duplication.
 */

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
  /**
   * 推理模型的思考链文本（DeepSeek-R1/V4-Flash 的 reasoning_content、OpenAI o系列）。
   * content 只放可见输出/动作 JSON，CoT 走此独立字段；不接则前端「思考」永远空。
   */
  reasoning?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  /** 标识此响应是否为错误消息（仅在非严格模式下有值） */
  isError?: boolean;
}

export interface EmbeddingApiResult {
  embeddings: number[][];
  totalTokens: number;
  model: string;
}
