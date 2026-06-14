/**
 * BusinessAgentTeam — Agent Invoker Framework 接口
 *
 * 业务方注入决策与事件钩子，让通用 retry/abort/backoff 骨架成立。
 *
 * 2026-05-24 @migrated-from 两个 ai-app 业务侧 invoker（playground + social 双源 invoker）
 *   - ai-app/playground/services/roles/agent-invoker.service.ts  @migrated-from
 *   - ai-app/social/services/roles/social-agent-invoker.service.ts  @migrated-from
 */

import type { IAgentEvent } from "@/modules/ai-harness/agents/abstractions/agent-event.interface";

/** invoke() 唯一上下文（业务侧也以此扩展） */
export interface BusinessTeamInvocationContext {
  readonly missionId: string;
  readonly userId: string;
  readonly agentId: string;
  readonly role: string;
}

/**
 * 业务侧实现的钩子集合。
 *
 * 框架（{@link BusinessTeamAgentInvokerFramework}）负责 retry/abort/backoff/lifecycle
 * 通用骨架；业务方仅实现:
 *   - invokeOnce: 单次实际调用（runner.run + 业务 billingMeta / onEvent 包装）
 *   - 可选 hooks: degraded / span lifecycle / pre-throw 等业务事件
 */
export interface BusinessTeamAgentInvokerHooks<TSpec, TInput, TResult> {
  /** 单次实际调用（不含 retry）—— 业务方实现 runner.run() + onEvent relay 包装 */
  invokeOnce(
    spec: TSpec,
    input: TInput,
    ctx: BusinessTeamInvocationContext,
  ): Promise<TResult>;

  /** Agent 事件 relay 入口（runner onEvent 触发，业务侧 emit 业务事件） */
  onAgentEvent?(
    event: IAgentEvent,
    ctx: BusinessTeamInvocationContext,
  ): Promise<void>;

  /** invoke 入口处开 agent-level span（业务侧可选实现） */
  onAgentStart?(ctx: BusinessTeamInvocationContext): void;

  /** invoke 退出时关 agent-level span，status 取自最终结果 */
  onAgentEnd?(
    ctx: BusinessTeamInvocationContext,
    status: "completed" | "failed",
    err?: Error,
  ): void;

  /**
   * 单次重试前回调（attempt 从 0 开始，业务侧可 emit 业务级 retry-warn 事件）。
   * 默认 framework 仅做 logger.warn，不强制业务方实现。
   */
  onRetry?(
    ctx: BusinessTeamInvocationContext,
    attempt: number,
    err: Error,
    delayMs: number,
  ): void;

  /**
   * 重试耗尽或永久错误，框架即将 re-throw 前的最后回调。
   * 业务侧通常在此 emit `stage:degraded` / `agent:lifecycle failed` 等业务事件。
   * 不允许 throw（异常会被 framework 吞掉并日志告警）。
   */
  onDegrade?(
    ctx: BusinessTeamInvocationContext,
    err: Error,
    info: {
      attempts: number;
      transient: boolean;
    },
  ): Promise<void>;
}

/** Framework 通用配置（不暴露给业务方修改的内部默认，但允许测试覆盖） */
export interface BusinessTeamAgentInvokerConfig {
  /** 首次失败后允许的额外尝试次数，默认 2（与原业务侧 MAX_ROLE_RETRIES=2 一致） */
  maxRetries?: number;
}
