/**
 * AiCallerFn — 通用 LLM 调用函数签名
 *
 * 2026-05-01 (PR-X-M2): 从 ai-harness/runner/executor/interfaces.ts 上移到
 * ai-engine/llm/types/，因为 LLM 调用函数签名是 L2 LLM 能力概念，不是
 * L2.5 runtime concern。harness/runner/executor/interfaces.ts re-export 保兼容。
 */
import type { TaskProfile } from "./index";

/**
 * AI 调用函数类型 — 用于依赖注入，允许上层传入带上下文的 AI 调用实现
 */
export type AiCallerFn = (
  model: string,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  options?: {
    maxTokens?: number;
    temperature?: number;
    taskProfile?: TaskProfile;
  },
) => Promise<{ content: string; tokensUsed: number }>;
