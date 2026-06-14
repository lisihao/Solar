/**
 * stage-emit util — stage:completed 事件统一封装
 *
 * ★ OBSERVABILITY (2026-04-30): 之前各 stage 自己手写 emit stage:completed，
 *   payload 字段五花八门、缺 durationMs / tokensUsed / agentInvocations 等共用度量。
 *   新建 emitStageCompleted helper 统一注入这些字段，让 UI 时间线 / monitoring
 *   能在一个地方拿到 stage 性能数据。stage 自己的业务字段仍可叠加。
 *
 * 2026-05-01 上提: 从 ai-app/{app} 上提到 ai-harness/protocols/ipc/。
 * `EmitFn` / `eventType` 参数化后跨 ai-app 通用。
 *
 * 用法（consumer 调用方）:
 *   const stageTimer = startStageTimer();
 *   ... 业务代码 ...
 *   await stageTimer.emitCompleted(emit, missionId, userId, {
 *     eventType: "{app}.stage:completed",
 *     stage: "leader",
 *     tokensUsed: 1234,
 *   });
 */

/** 通用 emit 签名 — 任何 ai-app 的 mission 编排都可用 */
export type EmitFn = (args: {
  type: string;
  missionId: string;
  userId: string;
  agentId?: string;
  traceId?: string;
  payload: unknown;
}) => Promise<void>;

/** Agent lifecycle callback — any ai-app mission orchestrator lifecycle hook */
export type LifecycleFn = (
  missionId: string,
  userId: string,
  agentId: string,
  role: string,
  phase: "started" | "completed" | "failed",
  detail?: Record<string, unknown>,
) => Promise<void>;

export interface StageTimerEmitOptions {
  /** 完整事件 type，由 ai-app 决定（如 "{app}.stage:completed"）*/
  eventType: string;
  /** stage 业务名（leader / researchers / analyst 等） */
  stage: string;
  /** stage 自己的业务 payload，会与公共字段合并 */
  custom?: Record<string, unknown>;
  /** 该 stage 累积调用 agent 次数（researcher 多 dim 时 > 1） */
  agentInvocations?: number;
  /** 该 stage 累积消耗 tokens（来自 pool 增量） */
  tokensUsed?: number;
  /** 该 stage 累积成本 USD */
  costUsd?: number;
  /** 该 stage 状态：completed / degraded / failed */
  status?: "completed" | "degraded" | "failed";
}

export interface StageTimer {
  startedAtMs: number;
  emitCompleted(
    emit: EmitFn,
    missionId: string,
    userId: string,
    opts: StageTimerEmitOptions,
  ): Promise<void>;
}

export function startStageTimer(): StageTimer {
  const startedAtMs = Date.now();
  return {
    startedAtMs,
    async emitCompleted(emit, missionId, userId, opts) {
      const durationMs = Date.now() - startedAtMs;
      await emit({
        type: opts.eventType,
        missionId,
        userId,
        payload: {
          stage: opts.stage,
          durationMs,
          status: opts.status ?? "completed",
          agentInvocations: opts.agentInvocations,
          tokensUsed: opts.tokensUsed,
          costUsd: opts.costUsd,
          ...(opts.custom ?? {}),
        },
      }).catch(() => {});
    },
  };
}
