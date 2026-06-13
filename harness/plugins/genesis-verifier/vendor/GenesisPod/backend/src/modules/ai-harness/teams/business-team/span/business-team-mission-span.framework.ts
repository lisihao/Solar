/**
 * BusinessAgentTeam — Mission Span Framework
 *
 * 通用 OTel span emission 骨架：每 mission 1 个 root span + 每 stage 1 个 child
 * span + 每 agent invocation 1 个孙 span。AgentTracer 由 HarnessModule 注入并把
 * 完成的 span 路由到 SpanExporter sinks (Logger + Langfuse when configured)。
 *
 * 2026-05-24 (P4) 抽取自 ai-app 业务侧 mission-span service:
 *   - ai-app/playground/services/mission/workflow/playground-mission-span.service.ts  @migrated-from
 *
 * 业务侧仅注入 namespace（span name 前缀，由各业务团队选自己的业务唯一名），
 * 通用 mission/stage/agent 三级嵌套语义（含 crash-resume 时旧 stage span 收尾保护）
 * 由 framework 承担。
 *
 * 业务侧扩展模板：
 * ```ts
 * @Injectable()
 * export class MyMissionSpanService extends BusinessTeamMissionSpanFramework {
 *   constructor(@Optional() tracer?: AgentTracer) {
 *     super(tracer, "my-app");
 *   }
 * }
 * ```
 */

import { Injectable, Optional } from "@nestjs/common";
// ★ 不走 facade barrel（与同目录其他 framework 一致）：facade/index.ts 会
//   re-export 本 framework，构成循环加载（详见 mission-runtime-shell.framework.ts
//   注释）。直接从 source 导入打破循环。
import { AgentTracer } from "@/modules/ai-harness/tracing/tracer/otel-tracer";
import type { Span } from "@/modules/ai-harness/tracing/tracer/otel-tracer";

/** Span 完成状态（与 AgentTracer.Span.end 语义对齐） */
export type BusinessTeamSpanStatus = "completed" | "failed" | "aborted";

@Injectable()
export class BusinessTeamMissionSpanFramework {
  /** Active mission-level root spans keyed by missionId */
  private readonly missionSpans = new Map<string, Span>();
  /** Active stage-level child spans keyed by `${missionId}:${stepId}` */
  private readonly stageSpans = new Map<string, Span>();
  /**
   * Tracks the currently-active stepId per mission so startAgentSpan can
   * resolve the parent stage span without the caller needing to pass stepId.
   */
  private readonly currentStepId = new Map<string, string>();
  /** Active agent-level child spans keyed by `${missionId}:${agentId}` */
  private readonly agentSpans = new Map<string, Span>();

  constructor(
    /** AgentTracer 可缺省（tracer 未配置 → 整 framework 是 no-op） */
    @Optional() protected readonly tracer: AgentTracer | undefined,
    /**
     * span name 前缀（业务命名空间，由各业务团队选自己的业务唯一名）；
     * span name 拼成 `${namespace}.mission` / `.stage.${stepId}` / `.agent`。
     */
    protected readonly namespace: string,
  ) {}

  /** Start a root span for the entire mission. */
  startMissionSpan(
    missionId: string,
    topic: string,
    extraAttributes?: Record<string, string>,
  ): void {
    if (!this.tracer) return;
    const span = this.tracer.startSpan(`${this.namespace}.mission`, {
      attributes: {
        missionId,
        topic,
        [`${this.namespace}.type`]: this.namespace,
        ...(extraAttributes ?? {}),
      },
    });
    this.missionSpans.set(missionId, span);
  }

  /** Start a child stage span under the mission root span. */
  startStageSpan(missionId: string, stepId: string, primitive: string): void {
    if (!this.tracer) return;
    const key = `${missionId}:${stepId}`;
    // Guard: if a span for this key already exists (stage re-entry on
    // crash-resume), end it as aborted before overwriting — prevents
    // orphaned spans in the exporter.
    const existing = this.stageSpans.get(key);
    if (existing) {
      existing.end({ status: "aborted" });
      this.stageSpans.delete(key);
    }
    const parent = this.missionSpans.get(missionId);
    const span = this.tracer.startSpan(`${this.namespace}.stage.${stepId}`, {
      parent,
      attributes: { missionId, stepId, primitive },
    });
    this.stageSpans.set(key, span);
    // Track active step so startAgentSpan can parent itself here.
    this.currentStepId.set(missionId, stepId);
  }

  /** End a stage span, recording failure if provided. */
  endStageSpan(
    missionId: string,
    stepId: string,
    status: "completed" | "failed",
    error?: unknown,
  ): void {
    const key = `${missionId}:${stepId}`;
    const span = this.stageSpans.get(key);
    if (!span) return;
    if (status === "failed" && error instanceof Error) {
      span.recordException(error);
    }
    span.end({ status });
    this.stageSpans.delete(key);
    // Clear current step tracking if it still points to this stepId.
    if (this.currentStepId.get(missionId) === stepId) {
      this.currentStepId.delete(missionId);
    }
  }

  /**
   * Start a child span for a single agent role invocation.
   *
   * The span is parented to the currently active stage span for the mission.
   * If no stage span is active (or tracer is absent), returns undefined — the
   * caller must handle this gracefully (i.e. skip endAgentSpan).
   *
   * Parent linkage: currentStepId[missionId] → stageSpans[missionId:stepId] → span.
   * The returned span's parentSpanId equals the stage span's spanId, placing it
   * directly under the stage node in the trace tree.
   */
  startAgentSpan(missionId: string, agentId: string): Span | undefined {
    if (!this.tracer) return undefined;
    const stepId = this.currentStepId.get(missionId);
    if (!stepId) return undefined;
    const parent = this.stageSpans.get(`${missionId}:${stepId}`);
    if (!parent) return undefined;
    const span = this.tracer.startSpan(`${this.namespace}.agent`, {
      parent,
      attributes: { missionId, agentId, stepId },
    });
    // Key by missionId:agentId — one active agent span per (mission, agentId) at a time.
    this.agentSpans.set(`${missionId}:${agentId}`, span);
    return span;
  }

  /** End the agent-level span for the given missionId + agentId. No-op if absent. */
  endAgentSpan(
    missionId: string,
    agentId: string,
    status: "completed" | "failed",
    error?: unknown,
  ): void {
    const key = `${missionId}:${agentId}`;
    const span = this.agentSpans.get(key);
    if (!span) return;
    if (status === "failed" && error instanceof Error) {
      span.recordException(error);
    }
    span.end({ status });
    this.agentSpans.delete(key);
  }

  /** End the root mission span. */
  endMissionSpan(
    missionId: string,
    status: BusinessTeamSpanStatus,
    error?: unknown,
  ): void {
    const span = this.missionSpans.get(missionId);
    if (!span) return;
    if (status === "failed" && error instanceof Error) {
      span.recordException(error);
    }
    span.end({ status });
    this.missionSpans.delete(missionId);
  }
}
