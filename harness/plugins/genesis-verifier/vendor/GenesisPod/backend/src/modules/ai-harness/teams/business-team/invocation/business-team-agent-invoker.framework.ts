/**
 * BusinessAgentTeam — Agent Invoker Framework
 *
 * 通用 invoker 骨架：retry loop + backoff + abort 短路 + agent span lifecycle。
 * 业务侧（各 ai-app 业务方）通过实现 {@link BusinessTeamAgentInvokerHooks} 注入
 * 业务专属语义（实际 runner.run / 业务事件 emit / span service / degraded payload 等）。
 *
 * 2026-05-24 @migrated-from 两个 ai-app 业务侧 invoker
 *   - ai-app/playground/services/roles/agent-invoker.service.ts  @migrated-from
 *   - ai-app/social/services/roles/social-agent-invoker.service.ts  @migrated-from
 *
 * 与 {@link MissionRuntimeShellFramework} 对称：mission lifecycle / role invocation 两个
 * 通用骨架现都在 ai-harness/teams/business-team 单一源。
 */

import { Logger } from "@nestjs/common";
// ★ 从 source 直引，不走 facade barrel（与同目录其他 framework 一致，详见 mission-runtime-shell.framework.ts）：
//   engine/harness facade barrel 会 re-export 本 framework / 海量符号，value-import 构成 import-time 循环加载。
import {
  isRetryableError,
  calculateBackoffDelay,
  sleep,
} from "@/modules/ai-engine/reliability/error-detection.utils";
import { MissionAbortRegistry } from "@/modules/ai-harness/lifecycle/mission-lifecycle/abort-registry";
import type { IAgentEvent } from "@/modules/ai-harness/agents/abstractions/agent-event.interface";
import type {
  BusinessTeamAgentInvokerConfig,
  BusinessTeamAgentInvokerHooks,
  BusinessTeamInvocationContext,
} from "./abstractions/business-team-agent-invoker.interface";

/**
 * 通用 retry+abort+backoff invoker 骨架。
 *
 * R2-#46 保留：
 *   - retry 仅对 transient error（isRetryableError 判定，网络/5xx/rate-limit）
 *   - 非 transient 错误（context overflow / auth / 4xx）立即抛出
 *   - 重试耗尽 → 业务方 `onDegrade` hook（不强制；用于 emit 业务 degraded 事件）
 *   - AbortSignal 中途短路 retry
 *
 * R3-#38 保留：
 *   - agent span lifecycle 在 invoke 入口/出口包裹整个 retry loop
 *   - span 由业务方 `onAgentStart` / `onAgentEnd` 实现（业务方注入自己的 span service，
 *     无 span 接入的业务方可不实现 hooks）
 */
export class BusinessTeamAgentInvokerFramework<TSpec, TInput, TResult> {
  private readonly log = new Logger(BusinessTeamAgentInvokerFramework.name);
  /** 首次调用 + 此值次 = 总尝试次数；默认 2 与原业务侧 MAX_ROLE_RETRIES 一致 */
  private readonly maxRetries: number;

  constructor(
    private readonly hooks: BusinessTeamAgentInvokerHooks<
      TSpec,
      TInput,
      TResult
    >,
    private readonly abortRegistry: MissionAbortRegistry,
    config?: BusinessTeamAgentInvokerConfig,
  ) {
    this.maxRetries = config?.maxRetries ?? 2;
  }

  /**
   * 统一执行入口（业务方通过 framework.invoke 触发整套骨架）。
   *
   * @returns 与 hooks.invokeOnce 同型；业务方对外接口签名通常直接转发。
   */
  async invoke(
    spec: TSpec,
    input: TInput,
    ctx: BusinessTeamInvocationContext,
  ): Promise<TResult> {
    this.hooks.onAgentStart?.(ctx);

    let lastError: Error = new Error("unknown role invocation error");
    try {
      for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
        try {
          const result = await this.hooks.invokeOnce(spec, input, ctx);
          this.hooks.onAgentEnd?.(ctx, "completed");
          return result;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));

          // Abort 立即短路（不算 retry，不算 degraded）
          if (ctx.missionId) {
            const signal = this.abortRegistry.getSignal(ctx.missionId);
            if (signal?.aborted) {
              throw lastError;
            }
          }

          const isTransient = isRetryableError(lastError.message);
          const canRetry = attempt < this.maxRetries && isTransient;
          if (canRetry) {
            const delayMs = calculateBackoffDelay(attempt);
            this.log.warn(
              `[BusinessTeamAgentInvoker] role=${ctx.role} mission=${ctx.missionId} ` +
                `attempt=${attempt + 1}/${this.maxRetries + 1} transient error — ` +
                `retrying in ${delayMs}ms: ${lastError.message}`,
            );
            this.hooks.onRetry?.(ctx, attempt, lastError, delayMs);
            await sleep(delayMs);
            continue;
          }

          // 进入 degraded 路径（永久错误 或 重试耗尽）
          const isDegraded = attempt >= this.maxRetries && isTransient;
          if (isDegraded) {
            this.log.error(
              `[BusinessTeamAgentInvoker] role=${ctx.role} mission=${ctx.missionId} ` +
                `degraded after ${this.maxRetries + 1} attempts: ${lastError.message}`,
            );
          }
          if (this.hooks.onDegrade) {
            try {
              await this.hooks.onDegrade(ctx, lastError, {
                attempts: attempt + 1,
                transient: isTransient,
              });
            } catch (degradeErr) {
              this.log.warn(
                `[BusinessTeamAgentInvoker] onDegrade hook threw (non-fatal): ` +
                  `${degradeErr instanceof Error ? degradeErr.message : String(degradeErr)}`,
              );
            }
          }
          throw lastError;
        }
      }
      // TypeScript flow guard — 不可达
      throw lastError;
    } catch (err) {
      const thrownErr = err instanceof Error ? err : new Error(String(err));
      this.hooks.onAgentEnd?.(ctx, "failed", thrownErr);
      throw thrownErr;
    }
  }
}

/**
 * 业务侧 onEvent 适配器构造器：把 runner.run() 的 onEvent 回调统一桥到 hooks.onAgentEvent。
 * 业务侧 invokeOnce 直接在 runner.run 的 options 里这样写：
 * ```ts
 *   onEvent: makeAgentEventForwarder(hooks, ctx)
 * ```
 */
export function makeAgentEventForwarder<TSpec, TInput, TResult>(
  hooks: BusinessTeamAgentInvokerHooks<TSpec, TInput, TResult>,
  ctx: BusinessTeamInvocationContext,
): (event: IAgentEvent) => Promise<void> {
  return async (event: IAgentEvent) => {
    if (hooks.onAgentEvent) {
      await hooks.onAgentEvent(event, ctx);
    }
  };
}
