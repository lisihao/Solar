/**
 * LLM hook payloads（v5.1 §11.4 CORE_HOOKS / standards/19 §三 规则 5）
 *
 * 泛化版 payload：业务类型 ChatRequest / ChatResponse 用 `unknown` 表达，
 * plugin 实现侧从 `request` cast 回业务类型；plugins/core 不依赖任何 module。
 *
 * 命名规则：与 hook id 严格对应。
 *   "engine.llm.request" → LlmRequestPayload
 *   "engine.llm.response" → LlmResponsePayload
 */
import type { HookMeta } from "./hook-meta";

export interface LlmRequestPayload {
  /** payload schema 版本，破坏性变更必须 bump（CRIT-1 / standards/19 §五 规则 9）*/
  readonly __version: 1;

  /** ai-engine 业务类型 ChatRequest 的不透明引用 */
  readonly request: unknown;

  /** v5.1 HIGH-3：cache 命中时用，命中前 plugin 用此 key 查缓存 */
  readonly cacheKey?: string;

  readonly meta: HookMeta;
}

export interface LlmResponsePayload {
  readonly __version: 1;
  readonly request: unknown;
  /** ai-engine 业务类型 ChatResponse 的不透明引用 */
  readonly raw: unknown;
  readonly tokensUsed?: number;
  /** v5.1 HIGH-3：abort 命中走 cache-hit 分支时为 true，billing/audit plugin 据此区分 */
  readonly cacheHit?: boolean;
  readonly meta: HookMeta;
}
