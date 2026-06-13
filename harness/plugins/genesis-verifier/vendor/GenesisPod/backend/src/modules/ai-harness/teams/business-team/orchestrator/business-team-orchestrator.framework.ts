/**
 * BusinessAgentTeam — Business Orchestrator Framework
 *
 * 三家 ai-app business orchestrator 的通用 skeleton:
 *
 *   - `bindSessionLookup(lookup)`   —— dispatcher.onModuleInit 注入 session 访问器
 *   - `protected getEntry(missionId)` —— framework 提供（未 bind 抛错）
 *   - `buildHooksForStep(stepId, primitive)` —— 主入口；调 resolveStageRunner +
 *     adaptRunnerToHooks
 *   - `protected abstract resolveStageRunner(stepId)` —— 业务方填表
 *   - `protected adaptRunnerToHooks(runner, stepId, primitive)` —— 默认实现:
 *     primitive → hook key（plan→runRole / persist→persist / ...），单 hook 模式。
 *     需要多 hook 的 stage（如 leader-plan 同时 runRole + extractPlanFields）
 *     业务方 override 本方法。
 *   - `getStageNumber(stepId)` —— stepId → DB stage number（可选 config 查询）
 *
 * **不下沉**：具体 stage hook 实现 / business event payload shape / report
 * assembly / stage script helper（buildStageInvariants / resolveTriggerType 等
 * 业务专属）；这些是 Tier 5 业务编排，留在 ai-app。
 *
 * StageAbortError signal 检查 —— framework adapter 在调 runner 之前 check
 * `args.ctx.signal?.aborted` → 抛 StageAbortError(stepId)；保留业务侧 orchestrator
 * 的现有 abort 保护机制。
 *
 * 业务侧扩展模板：详见 abstractions/business-team-orchestrator.contract.ts
 *
 * 2026-05-24 (P7) 抽取自:
 *   - ai-app/playground/services/mission/workflow/playground-business-orchestrator.service.ts  @migrated-from
 *   - ai-app/social/services/mission/workflow/social-business-orchestrator.service.ts  @migrated-from
 *   - ai-app/radar/services/mission/workflow/radar-business-orchestrator.service.ts  @migrated-from
 */

import { Logger } from "@nestjs/common";
// ★ 不走 facade barrel：facade/index.ts 会 re-export 本 framework，构成循环加载
//   （详见 mission-runtime-shell.framework.ts comment）。直接从 source 导入。
import { StageAbortError } from "../../services/stages/abstractions";
import type {
  BusinessTeamOrchestratorConfig,
  ResolvedStageHooks,
  SessionLookupFn,
  StageRunArgs,
  StageRunner,
  StageRunnerArgs,
} from "./abstractions/business-team-orchestrator.contract";
import { resolvePrimaryHookKey } from "./abstractions/stage-iteration.contract";

/**
 * 业务 orchestrator skeleton —— TSession 由业务方填具体 SessionEntry shape。
 *
 * Framework 只关心：通过 sessionLookup 拿 entry + 调 resolveStageRunner +
 * 把 runner 适配成 ResolvedStageHooks。具体 runner 内 ctx/deps 装配是业务侧
 * 职责。
 */
export abstract class BusinessTeamOrchestratorFramework<TSession> {
  protected readonly log: Logger;
  protected readonly config: BusinessTeamOrchestratorConfig;
  private sessionLookup?: SessionLookupFn<TSession>;
  /** primary hook key override map（业务方在 ctor 注入） */
  private readonly primaryHookOverrides?: Record<string, string>;

  constructor(
    config: BusinessTeamOrchestratorConfig,
    options?: { primaryHookOverrides?: Record<string, string> },
  ) {
    this.config = config;
    this.primaryHookOverrides = options?.primaryHookOverrides;
    this.log = new Logger(`${config.namespace}-business-orchestrator`);
  }

  /**
   * dispatcher.onModuleInit 调一次，把 sessions Map lookup 函数注入。
   *
   * 单向依赖：dispatcher → orchestrator；orchestrator 不引用 dispatcher 运行时类。
   */
  bindSessionLookup(lookup: SessionLookupFn<TSession>): void {
    this.sessionLookup = lookup;
  }

  /**
   * stepId → DB stageNumber（与 lifecycle markStageComplete 进度索引对齐）。
   * 未配置 stageNumber 时返回 undefined（业务方自行容错）。
   */
  getStageNumber(stepId: string): number | undefined {
    return this.config.stageNumber?.[stepId];
  }

  /**
   * 主入口：为 stepId 构建 ResolvedStageHooks（dispatcher.buildBaseHooksForStep
   * 调用）。
   *
   * Framework 调 resolveStageRunner（业务实现）+ adaptRunnerToHooks（默认实现
   * 单 hook，业务可 override 多 hook）。
   *
   * 找不到 runner 时抛 Error —— 与三家业务 orchestrator 现有行为一致
   * （pipeline registry 在 register 时已校验 step 完整性，runtime miss 视为 bug）。
   */
  buildHooksForStep(stepId: string, primitive: string): ResolvedStageHooks {
    const runner = this.resolveStageRunner(stepId);
    if (!runner) {
      throw new Error(
        `[${this.config.namespace}-business-orch] no stage runner for "${stepId}". ` +
          `All steps in ${this.config.namespace} pipeline must have an explicit branch in resolveStageRunner.`,
      );
    }
    return this.adaptRunnerToHooks(runner, stepId, primitive);
  }

  /**
   * 业务方填表：stepId → StageRunner。找不到时返回 null（framework 抛 "no runner"
   * 错误）。建议用 switch(stepId) 实现，让 TS exhaustiveness 检查覆盖所有 step。
   */
  protected abstract resolveStageRunner(
    stepId: string,
  ): StageRunner<TSession> | null;

  /**
   * 默认 adapter：把 runner 适配成 single-hook ResolvedStageHooks。
   *
   * 主 hook key 由 primitive 决定（plan→runRole / persist→persist / ...，
   * 见 DEFAULT_PRIMARY_HOOK_BY_PRIMITIVE）；业务方在 ctor 通过
   * primaryHookOverrides 注入覆盖。
   *
   * Framework 在调 runner 前 check `args.ctx.signal?.aborted` → 抛 StageAbortError
   * （保留业务 orchestrator 的 abort 保护机制，让 abort 立即停 stage 不进 runner）。
   *
   * 多 hook 模式（如 leader-plan stage 同时 runRole + extractPlanFields）业务方
   * override 本方法返回多 key 的 ResolvedStageHooks。
   */
  protected adaptRunnerToHooks(
    runner: StageRunner<TSession>,
    stepId: string,
    primitive: string,
  ): ResolvedStageHooks {
    const hookKey = resolvePrimaryHookKey(primitive, this.primaryHookOverrides);
    const getEntry = (missionId: string) => this.getEntry(missionId);
    // ResolvedStageHooks index signature 要求 hook return Promise<void>，但
    // runner 可能 return Promise<unknown>（业务 stage 输出供 stage primitive
    // 消费，如 plan output / synthesize result）。这里走 cast：runtime 上
    // runner return value 会被 primitive 透传给后续 hook，typing 上 framework
    // 不锁死（同三家业务 orchestrator 既有模式）。
    const hooks = {
      [hookKey]: async (args: unknown): Promise<unknown> => {
        const a = args as {
          ctx: StageRunArgs["ctx"];
          previousOutputs?: StageRunArgs["previousOutputs"];
          crossStageState?: StageRunArgs["crossStageState"];
          role?: StageRunArgs["role"];
        };
        if (a.ctx.signal?.aborted) {
          throw new StageAbortError(
            stepId,
            "mission cancelled (signal aborted)",
          );
        }
        const entry = getEntry(a.ctx.missionId);
        const runnerArgs: StageRunnerArgs = {
          ctx: a.ctx,
          previousOutputs: a.previousOutputs,
          crossStageState: a.crossStageState,
          role: a.role,
          stepId,
          primitive,
        };
        return runner(entry, runnerArgs);
      },
    };
    return hooks as unknown as ResolvedStageHooks;
  }

  /**
   * 通过 dispatcher 注入的 sessionLookup 拿 SessionEntry。
   * 未 bind 时抛错 —— bindSessionLookup 必须在 onModuleInit 阶段被调用。
   */
  protected getEntry(missionId: string): TSession {
    if (!this.sessionLookup) {
      throw new Error(
        `[${this.config.namespace}-business-orch] sessionLookup not bound; ` +
          `dispatcher must call bindSessionLookup() in onModuleInit`,
      );
    }
    return this.sessionLookup(missionId);
  }

  /** 子类 spec 可访问的内部状态查询（测试辅助） */
  protected isSessionLookupBound(): boolean {
    return this.sessionLookup !== undefined;
  }

  /**
   * 子类 soft-lookup（未 bind 时返回 undefined，不抛错）—— 业务需要在 hook
   * closure 内 best-effort 拿 entry（如 fan-out 子任务 checkpoint 回调可能在
   * 异常路径触发），用此方法避免 getEntry 抛错。
   */
  protected tryGetEntry(missionId: string): TSession | undefined {
    return this.sessionLookup?.(missionId);
  }
}
