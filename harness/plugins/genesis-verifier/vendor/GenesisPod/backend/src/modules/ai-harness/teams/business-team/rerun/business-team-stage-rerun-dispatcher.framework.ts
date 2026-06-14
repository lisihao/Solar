/**
 * BusinessAgentTeam — Stage Rerun Dispatcher Framework（P5 Wave 1，2026-05-24）
 *
 * @migrated-from ai-app/playground/services/mission/rerun/stage-rerun.dispatcher.ts
 *
 * 抽出 cascade rerun 的纯调度骨架（顺序执行、emit lifecycle、best-effort partial、
 * mutable ctx 共享、last-stage progress）；业务方注入 handlers + chain provider +
 * eventTypes 即可。
 *
 * 机制 vs 业务：
 *   机制（framework）：
 *     - rerunable 校验入站短路 throw BadRequest
 *     - cascade chain 顺序执行（throw → abort）
 *     - emit stage-started / cascade-aborted hook（业务 type）
 *     - 失败时 abortedAt + remaining 三元组返回（best-effort partial）
 *     - mutable ctx 在 cascade 链共享（handler 返 updated ctx 则下个 stage 用此）
 *
 *   业务（hook）：
 *     - handlers Map: stepId → StageRerunHandler<TContext>
 *     - computeChain: stepId → string[]（业务自己的 PIPELINE_STEPS 走 computeCascadeChain）
 *     - assertRerunable: stepId 入站校验（黑名单 / dag.rerunable）
 *     - buildStubs: 给 handlers 注入 DI 依赖（业务 stubs shape）
 *     - withCascadeScope: 业务在此包 MissionContext.run（可选）
 *     - markStageProgress: cascade 跑完每个 stage 写库（可选）
 */

import { BadRequestException, Logger } from "@nestjs/common";
import type {
  StageRerunHandler,
  CascadeRunInput,
  CascadeRunResult,
  CascadeRunHooks,
  CascadeStageStartedPayload,
  CascadeAbortedPayload,
} from "./abstractions/stage-rerun-handler.contract";

/**
 * TEmit 是 business 的 emit 函数实参类型（每业务不同：reference impl EmitFn 必带 missionId/userId
 * + traceId，generic emit 不带）。framework 内部不直接调 TEmit —— 它通过 `hooks.forwardEmit`
 * 把规范化 framework payload 投递给业务 emit；业务负责把 framework 的 normalized event
 * 包装成自己的 EmitFn args。
 */
export type FrameworkEmitEvent = {
  readonly type: string;
  readonly payload: unknown;
};

export abstract class BusinessTeamStageRerunDispatcherFramework<
  TContext,
  TStubs,
  TEmit,
> {
  protected readonly log: Logger;

  constructor(
    protected readonly hooks: CascadeRunHooks<TContext, TStubs, TEmit>,
  ) {
    this.log = hooks.log;
  }

  protected get handlers(): ReadonlyMap<
    string,
    StageRerunHandler<TContext, TStubs, TEmit>
  > {
    return this.hooks.handlers;
  }

  /**
   * Cascade rerun 主入口（按 stepId 起 cascade，best-effort partial）。
   *
   * 业务子类暴露 public method（如 runFromStageWithCascade）调用本方法。
   */
  protected async runFromStageWithCascade(
    args: CascadeRunInput<TContext, TEmit>,
  ): Promise<CascadeRunResult> {
    // 业务自定义 scope wrapping（如 MissionContext.run），默认透传
    const inner = (): Promise<CascadeRunResult> =>
      this.runFromStageWithCascadeInner(args);
    if (this.hooks.withCascadeScope) {
      return this.hooks.withCascadeScope(args.ctx, inner);
    }
    return inner();
  }

  private async runFromStageWithCascadeInner(
    args: CascadeRunInput<TContext, TEmit>,
  ): Promise<CascadeRunResult> {
    const { fromStepId, emit } = args;
    const ctx = args.ctx;

    // ── 1. 入参校验 ──
    const eligible = this.hooks.assertRerunable(fromStepId);
    if (!eligible.rerunable) {
      throw new BadRequestException(eligible.reason);
    }

    const cascadeChain = this.hooks.computeChain(fromStepId);
    this.log.log(
      `[cascade] from=${fromStepId} chain=${cascadeChain.join(" → ")}`,
    );

    // ── 2. 起 stubs（cascade 内共享）── ★ try/finally 保证 cleanupStubs 一定执行
    const stubs = this.hooks.buildStubs(ctx);
    const completed: string[] = [];
    try {
      return await this.runCascadeLoop({
        args,
        fromStepId,
        emit,
        cascadeChain,
        stubs,
        ctx,
        completed,
      });
    } finally {
      if (this.hooks.cleanupStubs) {
        try {
          await this.hooks.cleanupStubs(stubs);
        } catch (err) {
          this.log.warn(
            `[cascade] cleanupStubs failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
  }

  private async runCascadeLoop(args: {
    args: CascadeRunInput<TContext, TEmit>;
    fromStepId: string;
    emit: TEmit;
    cascadeChain: string[];
    stubs: TStubs;
    ctx: TContext;
    completed: string[];
  }): Promise<CascadeRunResult> {
    const { fromStepId, emit, cascadeChain, stubs, completed } = args;
    let ctx = args.ctx;
    for (let i = 0; i < cascadeChain.length; i++) {
      const stepId = cascadeChain[i];

      // emit stage-started（通过 forwardEmit hook 投递给业务 emit）
      const startedPayload: CascadeStageStartedPayload = {
        stepId,
        fromStepId,
        cascadeChain,
        completedSoFar: [...completed],
      };
      await this.hooks
        .forwardEmit(emit, ctx, {
          type: this.hooks.eventTypes.stageStarted,
          payload: startedPayload as unknown,
        })
        .catch((err: unknown) => {
          this.log.warn(
            `[cascade] emit ${this.hooks.eventTypes.stageStarted} failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });

      const handler = this.handlers.get(stepId);
      if (!handler) {
        const errorMessage = `stage ${stepId} 未注册 rerun handler`;
        this.log.error(`[cascade] ${errorMessage}`);
        const remaining = cascadeChain.slice(i);
        await this.emitCascadeAborted(emit, ctx, {
          stepId,
          completed,
          remaining,
          errorMessage,
        });
        return { completed, abortedAt: stepId, errorMessage, remaining };
      }

      try {
        const updated = await handler(ctx, emit, stubs);
        if (updated) {
          ctx = updated;
        }
        completed.push(stepId);
        if (this.hooks.markStageProgress) {
          await this.hooks
            .markStageProgress(ctx, stepId, [...completed])
            .catch((err: unknown) => {
              this.log.warn(
                `[cascade] markStageProgress for ${stepId} failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
              );
            });
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        this.log.warn(`[cascade] aborted at ${stepId}: ${errorMessage}`);
        const remaining = cascadeChain.slice(i + 1);
        await this.emitCascadeAborted(emit, ctx, {
          stepId,
          completed,
          remaining,
          errorMessage,
        });
        return { completed, abortedAt: stepId, errorMessage, remaining };
      }
    }

    return { completed };
  }

  private async emitCascadeAborted(
    emit: TEmit,
    ctx: TContext,
    args: {
      stepId: string;
      completed: string[];
      remaining: string[];
      errorMessage: string;
    },
  ): Promise<void> {
    const payload: CascadeAbortedPayload = {
      abortedAt: args.stepId,
      completed: [...args.completed],
      remaining: args.remaining,
      errorMessage: args.errorMessage,
      partialModeNote:
        "best-effort partial: 已成 stage 的 patch 保留，未跑下游不动",
    };
    await this.hooks
      .forwardEmit(emit, ctx, {
        type: this.hooks.eventTypes.cascadeAborted,
        payload: payload as unknown,
      })
      .catch((err: unknown) => {
        this.log.warn(
          `[cascade] emit ${this.hooks.eventTypes.cascadeAborted} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }
}
