/**
 * MissionPipelineOrchestrator — pipeline 执行引擎（v5.1 §3.2 R1-B）
 *
 * 责任：
 *   1. 解析 PipelineConfig：roleId → ResolvedRole；primitive id → IStagePrimitive
 *   2. 顺序执行 steps：每 step 调 primitive.run(args)
 *   3. 维护 stage outputs（按 step.id 索引），传给后续 step.previousOutputs
 *   4. CrossStageState 跨 step 共享（v5.1 §3.4 P0-F）
 *   5. emit MissionEvent（启停 / 每 step 结果）
 *   6. timeout / abort / StageAbortError 处理
 *   7. resume 入口：从 lastCompletedStage+1 续跑（v5.1 §3.4 崩溃 resume）
 *
 * 依赖注入（构造期）：
 *   - registry: MissionPipelineRegistry
 *
 * 不依赖 plugins/core HookBus（PR-11 PluginCoreModule 之后的扩展任务）；
 * 但本 orchestrator 自己 emit MissionEvent，业务监听者可订阅。
 */
import { Injectable, Logger } from "@nestjs/common";
import { CrossStageState } from "../../services/stages/abstractions";
import {
  type MissionContext,
  type ResolvedRole,
  StageAbortError,
} from "../../services/stages/abstractions";
import { MissionPipelineRegistry } from "./mission-pipeline-registry.service";
import {
  type MissionPipelineConfig,
  type ResolvedPipelineStep,
} from "./mission-pipeline-config";

/**
 * MissionEvent — orchestrator 在执行流中 emit 的事件
 */
export interface MissionEvent {
  readonly type:
    | "mission:started"
    | "mission:completed"
    | "mission:failed"
    | "mission:aborted"
    | "stage:started"
    | "stage:completed"
    | "stage:failed"
    /** ★ 2026-05-06 (A-6): 软失败信号，stage 内部 catch 决定不阻断但要让用户可见 */
    | "stage:degraded"
    /** ★ 2026-05-06 (A-9): watchdog 检测到 stage 卡顿（started 后超过阈值未完成）*/
    | "stage:stalled";
  readonly missionId: string;
  readonly stepId?: string;
  readonly primitive?: string;
  readonly output?: unknown;
  readonly error?: unknown;
  readonly timestamp: number;
  /** stage:degraded / stage:stalled 携带的额外信息 */
  readonly reason?: string;
  readonly elapsedMs?: number;
}

/**
 * Mission 执行结果
 */
export interface MissionResult {
  readonly missionId: string;
  readonly status: "completed" | "failed" | "aborted";
  readonly stageOutputs: Readonly<Record<string, unknown>>;
  readonly crossStageState: Readonly<Record<string, unknown>>;
  readonly error?: unknown;
}

/**
 * Run 输入参数
 */
export interface RunPipelineArgs<TInput = unknown> {
  readonly missionId: string;
  readonly pipelineId: string;
  readonly input: TInput;
  readonly userId?: string;
  readonly tenantId?: string;
  readonly signal?: AbortSignal;
  /** resume 入口：从该 stepId 之后开始（含已有的 stageOutputs / crossStageState）*/
  readonly resumeFromStepId?: string;
  readonly initialStageOutputs?: Readonly<Record<string, unknown>>;
  readonly initialCrossStageState?: Readonly<Record<string, unknown>>;
  /** event listener（每个 MissionEvent emit 时调用）*/
  readonly onEvent?: (event: MissionEvent) => void | Promise<void>;
}

@Injectable()
export class MissionPipelineOrchestrator {
  private readonly logger = new Logger(MissionPipelineOrchestrator.name);

  constructor(private readonly registry: MissionPipelineRegistry) {}

  /**
   * 执行一个 mission 的完整 pipeline
   */
  async run<TInput = unknown>(
    args: RunPipelineArgs<TInput>,
  ): Promise<MissionResult> {
    const config = this.registry.get(args.pipelineId);
    const resolvedSteps = this.resolveSteps(config);

    const stageOutputs: Record<string, unknown> = {
      ...(args.initialStageOutputs ?? {}),
    };
    const crossStageState = CrossStageState.fromJSON(
      args.initialCrossStageState ?? {},
    );

    // resume 起点
    let startIndex = 0;
    if (args.resumeFromStepId) {
      const idx = resolvedSteps.findIndex(
        (s) => s.step.id === args.resumeFromStepId,
      );
      if (idx === -1) {
        throw new Error(
          `[MissionPipelineOrchestrator] resumeFromStepId "${args.resumeFromStepId}" not in pipeline`,
        );
      }
      startIndex = idx + 1; // 从该 step 之后开始
    }

    const ctx: MissionContext<TInput> = {
      missionId: args.missionId,
      userId: args.userId,
      tenantId: args.tenantId,
      input: args.input,
      statefulRoleStates: {},
      signal: args.signal,
    };

    await this.emit(args.onEvent, {
      type: "mission:started",
      missionId: args.missionId,
      timestamp: Date.now(),
    });

    try {
      for (let i = startIndex; i < resolvedSteps.length; i++) {
        // signal 检查
        if (args.signal?.aborted) {
          throw new StageAbortError(
            resolvedSteps[i].step.id,
            "mission cancelled (signal aborted)",
          );
        }

        // ★ #44 (2026-05-23): S4‖S5 narrow parallel execution.
        //
        //   Guard (verified against caller-provided DAG metadata):
        //     S4 ctxWrites: []                    S5 ctxWrites: ["reconciliationReport"]
        //     S4 ctxReads:  ["plan","researcherResults"]
        //     S5 ctxReads:  ["researcherResults"]
        //   → ctxWrites disjoint; S4 does not read S5's writes
        //   → Both read crossState values synchronously before their first await
        //     (Node.js single-threaded async) → no race condition on reads
        //   → dbWrites: S4=["leader_journal"], S5=["reconciliation_report"] — different cols
        //
        //   Event ordering: emit stage:started for BOTH before either stage:completed.
        //   Resume: if resumeFromStepId targets S4 or S5, startIndex resolves to idx+1
        //   of whichever was the last completed; if S4 was last we skip to S5's idx
        //   (which means we skip past i=S4's idx and start at i=S5's idx, handled by
        //   the standard resume startIndex logic — the parallel block only fires when
        //   i is at S4's index and S5 is immediately next).
        const resolved = resolvedSteps[i];
        const nextResolved = resolvedSteps[i + 1];
        const isS4S5Pair =
          resolved.step.id === "s4-leader-assess" &&
          nextResolved?.step.id === "s5-reconciler";

        if (isS4S5Pair) {
          // Both start before either finishes — emit stage:started for both first
          const [out4, out5] = await Promise.all([
            this.runStep(
              resolved,
              ctx,
              crossStageState,
              stageOutputs,
              args.onEvent,
            ),
            this.runStep(
              nextResolved,
              ctx,
              crossStageState,
              stageOutputs,
              args.onEvent,
            ),
          ]);
          stageOutputs[resolved.step.id] = out4;
          stageOutputs[nextResolved.step.id] = out5;
          i += 1; // skip S5 in next iteration
          continue;
        }

        const output = await this.runStep(
          resolved,
          ctx,
          crossStageState,
          stageOutputs,
          args.onEvent,
        );
        stageOutputs[resolved.step.id] = output;
      }

      await this.emit(args.onEvent, {
        type: "mission:completed",
        missionId: args.missionId,
        timestamp: Date.now(),
      });
      return {
        missionId: args.missionId,
        status: "completed",
        stageOutputs,
        crossStageState: crossStageState.toJSON(),
      };
    } catch (err) {
      const isAbort = err instanceof StageAbortError;
      await this.emit(args.onEvent, {
        type: isAbort ? "mission:aborted" : "mission:failed",
        missionId: args.missionId,
        error: err,
        timestamp: Date.now(),
      });
      return {
        missionId: args.missionId,
        status: isAbort ? "aborted" : "failed",
        stageOutputs,
        crossStageState: crossStageState.toJSON(),
        error: err,
      };
    }
  }

  /**
   * 解析 PipelineConfig 中所有 step（启动期一次性把 primitive + role 解析好）
   */
  private resolveSteps(config: MissionPipelineConfig): ResolvedPipelineStep[] {
    const roleById = new Map<string, ResolvedRole>();
    for (const r of config.roles) {
      roleById.set(r.id, {
        id: r.id,
        skillSpec: r.skillSpec,
        stateful: r.stateful ?? false,
      });
    }

    return config.steps.map((step) => ({
      step,
      primitive: this.registry.resolvePrimitive(step.primitive),
      role: step.roleId ? roleById.get(step.roleId) : undefined,
      timeoutMs: step.timeoutMs ?? config.defaultStepTimeoutMs,
    }));
  }

  /**
   * 执行单个 step（含 timeout + event emit）
   */
  private async runStep(
    resolved: ResolvedPipelineStep,
    ctx: MissionContext,
    crossStageState: CrossStageState,
    stageOutputs: Readonly<Record<string, unknown>>,
    onEvent?: RunPipelineArgs["onEvent"],
  ): Promise<unknown> {
    const { step, primitive, role, timeoutMs } = resolved;

    const stageStartedAt = Date.now();
    await this.emit(onEvent, {
      type: "stage:started",
      missionId: ctx.missionId,
      stepId: step.id,
      primitive: step.primitive,
      timestamp: stageStartedAt,
    });

    // ★ 2026-05-06 (重大整改): 平台层删除 stage 死秒表 (`withTimeout` race)。
    //
    //   死秒表是垃圾机制：N 秒到了无论 stage 内部子事件流还在不在动都强杀。
    //   S3 多 dim 并行 + 工具调用 + LLM retry 累加 > 10min 是常见场景，但 dim
    //   每秒在 emit cost:tick / agent:thought 真在干活——死秒表完全不感知。
    //
    //   新机制（统一 + 简化 + 联动）：
    //     1. **stage 不再有 abort timer**——直接 `await primitive.run(...)`，跑到
    //        完成 / primitive 内部主动 throw（如 LLM HTTP timeout 抛上来）。
    //     2. **inactivity 检测在 mission level**：MissionLivenessGuard 监听
    //        EventBus 该 missionId 事件流；stage 内子事件 emit → 自动刷新
    //        liveness signal → mission 不会被误杀。真没活动 5min 才视为死。
    //     3. **wall-clock 上限在 mission level**：mission-runtime-shell 的
    //        wallTimer 防 LLM 死循环（默认 mission 总长 ≤ 3h）。
    //     4. **stallVisibilityMs**（保留 step.timeoutMs * 1.5 / 默认 15min）仅作
    //        可见性 emit `stage:stalled` warning，不再杀 stage。
    //
    //   联动信号源：EventBus 该 missionId 事件流（同时驱动 liveness +
    //   stall watchdog + heartbeat）。所有走 PipelineOrchestrator 的 ai-app
    //   一起受益（统一平台机制）。
    const stallVisibilityMs = Math.max(
      timeoutMs ? Math.floor(timeoutMs * 1.5) : 15 * 60 * 1000,
      60_000,
    );
    let stageDone = false;
    const stallTimer = setTimeout(() => {
      if (stageDone) return;
      void this.emit(onEvent, {
        type: "stage:stalled",
        missionId: ctx.missionId,
        stepId: step.id,
        primitive: step.primitive,
        elapsedMs: Date.now() - stageStartedAt,
        reason: `stage 跑超 ${Math.round(stallVisibilityMs / 60_000)} 分钟仍未完成（仅警告 — mission liveness guard 决定真死活）`,
        timestamp: Date.now(),
      }).catch(() => undefined);
    }, stallVisibilityMs);
    (stallTimer as { unref?: () => void }).unref?.();

    try {
      // primitive.run 期望 ResolvedRole；step 没指定 role 时用 placeholder
      const roleArg: ResolvedRole = role ?? {
        id: "_no-role",
        stateful: false,
        skillSpec: {
          id: "_no-role",
          systemPrompt: "",
          allowedToolIds: [],
          allowedModels: [],
          // outputSchema 需要 zod 实例；用 unknown 类型 bypass（primitive 不会真校验）
          outputSchema: { safeParse: () => ({ success: true }) } as never,
          meta: {},
        },
      };

      // ★ 直接 await，不再 race timeout。stage 跑到 primitive.run 完成 / 抛错为止。
      // 真死活由 mission level liveness + wall timer 兜底（见上注释）。
      const output = await primitive.run({
        ctx,
        role: roleArg,
        config: step,
        hooks: step.hooks ?? {},
        crossStageState,
        previousOutputs: stageOutputs,
      });

      stageDone = true;
      clearTimeout(stallTimer);
      await this.emit(onEvent, {
        type: "stage:completed",
        missionId: ctx.missionId,
        stepId: step.id,
        primitive: step.primitive,
        output,
        timestamp: Date.now(),
      });
      return output;
    } catch (err) {
      stageDone = true;
      clearTimeout(stallTimer);
      await this.emit(onEvent, {
        type: "stage:failed",
        missionId: ctx.missionId,
        stepId: step.id,
        primitive: step.primitive,
        error: err,
        timestamp: Date.now(),
      });
      throw err;
    }
  }

  // ★ 2026-05-06 重大整改: 删除 stage 死秒表 withTimeout 函数。
  //   stage abort 由 (1) mission-runtime-shell wallTimer 兜底防 LLM 死循环
  //   (2) MissionLivenessGuard 监听 inactivity 5min 兜底。
  //   stage 层不再持有秒表机制，避免对并行子任务的误杀。

  /** event emit 包装：吞掉 listener 异常防止影响 mission 主流程 */
  private async emit(
    onEvent: RunPipelineArgs["onEvent"],
    event: MissionEvent,
  ): Promise<void> {
    if (!onEvent) return;
    try {
      await onEvent(event);
    } catch (err) {
      this.logger.warn(
        `[MissionPipelineOrchestrator] event listener threw: ${String(err)}`,
      );
    }
  }
}

/** 仅给 step 一个 placeholder skillSpec（避免 type-only export 冲突） */
export type _RoleArg = ResolvedRole;
