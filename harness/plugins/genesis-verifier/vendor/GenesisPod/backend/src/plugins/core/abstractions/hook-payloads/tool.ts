/**
 * Tool hook payloads（v5.1 §11.4 CORE_HOOKS / standards/19 §三）
 *
 * 含 v5.1 P0-1 修订的 TOOL_WRAP（带 AbortSignal 的包装语义）payload。
 *
 * 命名规则：
 *   "engine.tool.before" → ToolBeforePayload
 *   "engine.tool.wrap"   → ToolWrapPayload    (v5.1 P0-1 新增)
 *   "engine.tool.after"  → ToolAfterPayload
 */
import type { HookMeta } from "./hook-meta";

export interface ToolBeforePayload {
  readonly __version: 1;
  /** ai-engine ToolCall 业务类型不透明引用 */
  readonly call: unknown;
  readonly meta: HookMeta;
}

/**
 * v5.1 P0-1 新增：TOOL_WRAP payload
 * 用于 timeout / sandbox / retry 等需要"包裹 terminal 执行"的 plugin。
 * - signal: plugin 可以 abort 调用方（如 timeout 触发）
 * - 与 TOOL_BEFORE 区别：TOOL_BEFORE 是入口拦截（abort 即短路），
 *   TOOL_WRAP 是执行包裹（plugin 内部 await terminal 后再处理）
 */
export interface ToolWrapPayload {
  readonly __version: 1;
  readonly call: unknown;
  readonly signal: AbortSignal;
  readonly meta: HookMeta;
}

export interface ToolAfterPayload {
  readonly __version: 1;
  readonly call: unknown;
  /** ai-engine 业务类型 ToolResult 不透明引用 */
  readonly result: unknown;
  /** v5.1 HIGH-3：cache 命中时为 true */
  readonly cacheHit?: boolean;
  /** v5.1 P0-1：abort 后仍 fire TOOL_AFTER 时携带 abort 原因 */
  readonly abortReason?: string;
  readonly meta: HookMeta;
}
