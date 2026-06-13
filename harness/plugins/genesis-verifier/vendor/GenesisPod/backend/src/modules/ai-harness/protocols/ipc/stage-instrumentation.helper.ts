/**
 * stage-instrumentation.helper —— 通用 stage boilerplate wrapper
 *
 * 目的：消灭 ai-app stage 文件里 50% boilerplate（emit started / lifecycle /
 * narrate thinking + success / startStageTimer / emit completed）。把这些通用
 * instrumentation 抽到 harness，让 ai-app stage 文件只剩业务核心。
 *
 * 收益（典型 ai-app mission 14 stage 计算）：
 *   - 删除 14 × ~40 行 boilerplate ≈ 560 行
 *   - stage 文件从平均 250 行降到 100 行（业务逻辑 + 配置）
 *   - 让 ai-app stage 文件从"代码模板"向"配置驱动模板"演进一大步
 *
 * 适用范围：
 *   ✅ 单业务调用 stage（如 leader plan / analyst synthesize / writer single-shot）
 *   ⚠️ 多迭代 stage（如 per-dim research / per-chunk write）需要外层 wrapper
 *      + 内层手动 emit per-iteration —— 仍可用本 wrapper 包外层
 *   ⚠️ 多 skip-condition stage（如 thorough+ only outline planner）—— 早 return
 *      场景下仍需手动 emit "skipped" event，wrapper 仅包"非 skip 路径"
 *
 * 渐进式迁移建议：每 PR 迁 1-2 stage，跑 spec 验证后再下一个。
 *
 * 用法：
 *   await runWithStageInstrumentation(ctx, deps, {
 *     eventPrefix: "<ai-app>",  // 由 ai-app 提供，不硬编码
 *     stageId: "stage-id",
 *     role: "role-name",
 *     narrateThinking: "...",
 *     narrateSuccess: (out) => `...`,
 *     emitExtras: async (out) => deps.emit({...}),
 *   }, async () => {
 *     return await businessCall(...);
 *   });
 */
import type { StageTimer } from "./stage-emit.utils";
import { startStageTimer } from "./stage-emit.utils";

export interface StageInstrumentationCtx {
  readonly missionId: string;
  readonly userId: string;
  readonly pool?: { snapshot?(): { poolTokensUsed?: number } | undefined };
}

export interface StageInstrumentationDeps {
  emit: (event: {
    type: string;
    missionId: string;
    userId: string;
    agentId?: string;
    traceId?: string;
    payload: unknown;
  }) => Promise<void>;
  lifecycle: (
    missionId: string,
    userId: string,
    role: string,
    agentId: string,
    state: "started" | "completed" | "failed",
    extra?: Record<string, unknown>,
  ) => Promise<void>;
}

/**
 * narrate 函数签名 —— ai-app 各自实现。stage 字段是 ai-app 自己定义的 union，
 * 用 `unknown` 在 wrapper 边界处接收，由 ai-app narrate 自己 typecheck。
 */
export type NarrateFn = (
  emit: StageInstrumentationDeps["emit"],
  missionId: string,
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any,
) => Promise<void>;

export interface StageInstrumentationConfig<TOutput> {
  /** 业务方 event prefix（如 "<ai-app>"），不硬编码 */
  readonly eventPrefix: string;
  /** stage id，narrate 用（业务方自定义，例如 "step-plan" 或 "phase-research"） */
  readonly stageId: string;
  /** role id（lifecycle 事件 role / narrate role） */
  readonly role: string;
  /** narrate 函数（业务方提供，因为 narrate 实现可能各 ai-app 不同） */
  readonly narrate?: NarrateFn;
  /** 进入 stage 时 narrate 的 thinking 文案 */
  readonly narrateThinking?: string;
  /** 完成 stage 时 narrate 的 success 文案（接收业务输出） */
  readonly narrateSuccess?: (output: TOutput) => string;
  /** stage 业务专属的额外 emit（如 "leader:goals-set"），可选 */
  readonly emitExtras?: (output: TOutput) => Promise<void>;
  /** 可选：附加到 stage:metrics 的 custom 字段 */
  readonly customMetrics?: (output: TOutput) => Record<string, unknown>;
  /** 可选：覆盖 agentInvocations（默认 1） */
  readonly agentInvocations?: number;
}

/**
 * Run `business()` 包在标准 stage instrumentation 内：
 *   1. emit "stage:metrics"
 *   2. lifecycle "started"
 *   3. (可选) narrate thinking
 *   4. business() — 业务核心
 *   5. (失败) lifecycle "failed" + rethrow
 *   6. lifecycle "completed"
 *   7. (可选) emitExtras
 *   8. emit "stage:metrics"（带 tokensUsed / durationMs）
 *   9. (可选) narrate success
 */
export async function runWithStageInstrumentation<TOutput>(
  ctx: StageInstrumentationCtx,
  deps: StageInstrumentationDeps,
  config: StageInstrumentationConfig<TOutput>,
  business: () => Promise<TOutput>,
): Promise<TOutput> {
  const stageTimer: StageTimer = startStageTimer();
  const tokensBefore = ctx.pool?.snapshot?.()?.poolTokensUsed ?? 0;

  await deps.emit({
    type: `${config.eventPrefix}.stage:metrics`,
    missionId: ctx.missionId,
    userId: ctx.userId,
    payload: { stage: config.role, startedAtMs: stageTimer.startedAtMs },
  });
  await deps.lifecycle(
    ctx.missionId,
    ctx.userId,
    config.role,
    config.role,
    "started",
  );

  if (config.narrate && config.narrateThinking) {
    await config.narrate(deps.emit, ctx.missionId, ctx.userId, {
      stage: config.stageId,
      role: config.role,
      tag: "thinking",
      text: config.narrateThinking,
      agentId: config.role,
    });
  }

  let output: TOutput;
  try {
    output = await business();
  } catch (err) {
    await deps.lifecycle(
      ctx.missionId,
      ctx.userId,
      config.role,
      config.role,
      "failed",
      { error: err instanceof Error ? err.message : String(err) },
    );
    throw err;
  }

  await deps.lifecycle(
    ctx.missionId,
    ctx.userId,
    config.role,
    config.role,
    "completed",
    {},
  );

  if (config.emitExtras) {
    await config.emitExtras(output).catch(() => undefined);
  }

  const tokensAfter = ctx.pool?.snapshot?.()?.poolTokensUsed ?? 0;
  await stageTimer.emitCompleted(deps.emit, ctx.missionId, ctx.userId, {
    eventType: `${config.eventPrefix}.stage:metrics`,
    stage: config.role,
    tokensUsed: tokensAfter - tokensBefore,
    agentInvocations: config.agentInvocations ?? 1,
    custom: config.customMetrics ? config.customMetrics(output) : undefined,
  });

  if (config.narrate && config.narrateSuccess) {
    await config.narrate(deps.emit, ctx.missionId, ctx.userId, {
      stage: config.stageId,
      role: config.role,
      tag: "success",
      text: config.narrateSuccess(output),
      agentId: config.role,
    });
  }

  return output;
}
