/**
 * Hook — Agent 运行时生命周期钩子
 *
 * 6 个生命周期事件点，借鉴 Claude Code 的 hook 设计。
 * Hook 可以：阻断后续（返回 { block: true }）、改写参数、记录日志。
 */

import type { IAction, IActionResult } from "./action.interface";
import type { IContextEnvelope } from "./context-envelope.interface";
import type { ISubagentSpawnAction } from "./action.interface";

export type HookEvent =
  | "SessionStart"
  | "UserPromptSubmit"
  | "PreToolUse"
  | "PostToolUse"
  | "PreSubagentSpawn"
  | "Stop";

/** Hook 作用域：越靠前优先级越高 */
export type HookScope = "global" | "agent" | "role" | "skill";

/** Hook 返回值 */
export interface IHookResult {
  /** 阻断后续 hook 与默认行为 */
  block?: boolean;
  /** 阻断原因（observability） */
  reason?: string;
  /** 可选的替换 payload（例如改写 action input） */
  replacePayload?: unknown;
}

/** Hook payload 类型映射 */
export interface HookPayloadMap {
  SessionStart: { sessionId: string; userId?: string };
  UserPromptSubmit: { prompt: string; envelope: IContextEnvelope };
  PreToolUse: { action: IAction };
  PostToolUse: { action: IAction; result: IActionResult };
  PreSubagentSpawn: { spec: ISubagentSpawnAction };
  Stop: { reason: "completed" | "error" | "budget" | "cancelled" };
}

/** Hook 回调签名 */
export type HookCallback<E extends HookEvent> = (
  payload: HookPayloadMap[E],
  context: { agentId: string; envelope: IContextEnvelope },
) => IHookResult | Promise<IHookResult> | void | Promise<void>;

/** Hook 注册项 */
export interface IHookBinding<E extends HookEvent = HookEvent> {
  event: E;
  scope: HookScope;
  scopeTarget?: string; // agentId / roleId / skillId
  handler: HookCallback<E>;
  priority?: number; // 默认 0，数字大先跑
  /**
   * P0-6: 借鉴 Claude Code query.ts:1262-1264。
   * true = API error 路径不执行此 Stop hook（防止 hook 注入新 token → PTL → retry storm）。
   * 默认 undefined（视为 false），向后兼容。
   */
  skipOnApiError?: boolean;
}

/** Hook Registry 对外接口 */
export interface IHookRegistry {
  register<E extends HookEvent>(binding: IHookBinding<E>): () => void;
  dispatch<E extends HookEvent>(
    event: E,
    payload: HookPayloadMap[E],
    context: { agentId: string; envelope: IContextEnvelope },
  ): Promise<IHookResult>;
  /** P0-6: 带 isApiError 标志的 Stop 派发，跳过 skipOnApiError=true 的 hook */
  dispatchStop(
    payload: HookPayloadMap["Stop"],
    context: { agentId: string; envelope: IContextEnvelope },
    isApiError: boolean,
  ): Promise<IHookResult>;
  /** P0-6: 是否有任何 Stop hook 标记了 skipOnApiError=true */
  hasAnySkipOnApiErrorStopHook(): boolean;
}
