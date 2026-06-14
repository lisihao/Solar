import { Injectable, Logger, Optional } from "@nestjs/common";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/common/prisma/prisma.service";
import { LruMap } from "@/common/utils/lru-map";
import type {
  LatencySession,
  LatencyStep,
  LatencyAction,
  LatencySessionSummary,
  LatencyPercentileStats,
  StepSummary,
  StartSessionInput,
  StartStepInput,
  RecordActionInput,
  ListSessionsFilter,
} from "./session-latency.types";

/**
 * Session Latency Tracker Service
 *
 * 会话级端到端时延跟踪基础能力（L2 AI Kernel）。
 *
 * 四级结构（业界规范）：Session → Step → Action
 * - Session: 一次完整研究
 * - Step: 业务语义单元（如 "搜索数据"、"章节写作"），可包含 0~N 个 Action
 * - Action: 一次原子操作（LLM 调用或工具调用）
 *
 * 使用方式：
 * ```typescript
 * const sessionId = tracker.startSession({ type: "topic_insights_refresh", entityId: topicId });
 * const stepId = tracker.startStep(sessionId, { name: "TTLT定义/搜索数据" });
 * // LLM calls auto-recorded via MissionContext → recordAction()
 * tracker.endStep(sessionId, stepId);
 * const summary = tracker.endSession(sessionId);
 * ```
 */
@Injectable()
export class SessionLatencyTrackerService {
  private readonly logger = new Logger(SessionLatencyTrackerService.name);

  /** 活跃会话 LRU 缓存 */
  private readonly sessions = new LruMap<string, LatencySession>(500);

  constructor(@Optional() private readonly prisma?: PrismaService) {}

  // ==================== Session Lifecycle ====================

  startSession(input: StartSessionInput): string {
    const sessionId = randomUUID();
    const session: LatencySession = {
      id: sessionId,
      type: input.type,
      status: "running",
      userId: input.userId,
      entityId: input.entityId,
      metadata: input.metadata || {},
      startTime: Date.now(),
      steps: [],
    };
    this.sessions.set(sessionId, session);
    this.logger.debug(
      `[Session] Started: ${input.type} [${sessionId}] entity=${input.entityId ?? "N/A"}`,
    );
    return sessionId;
  }

  endSession(
    sessionId: string,
    status: "completed" | "failed" = "completed",
  ): LatencySessionSummary | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.logger.warn(`[Session] Not found: ${sessionId}`);
      return undefined;
    }

    const now = Date.now();
    session.endTime = now;
    session.status = status;

    // 自动关闭未结束的 step
    for (const step of session.steps) {
      if (!step.endTime) {
        step.endTime = now;
        step.durationMs = step.endTime - step.startTime;
      }
    }

    const summary = this.computeSummary(session);

    // DB 持久化（fire-and-forget）
    this.persistSession(session, summary).catch((e) =>
      this.logger.debug(`[Session] Persist failed: ${e}`),
    );

    this.logger.log(
      `[Session] Ended: ${session.type} [${sessionId}] ` +
        `total=${summary.totalDurationMs}ms steps=${summary.steps.length} ` +
        `actions=${summary.llmCallCount} ttlt_avg=${summary.ttlt?.avgMs?.toFixed(0) ?? "N/A"}ms`,
    );

    return summary;
  }

  getSession(sessionId: string): LatencySession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * 按 entityId 查找内存中活跃的 session（用于研究进行中的实时展示）
   */
  getActiveSessionSummary(
    entityId: string,
    type?: string,
  ): LatencySessionSummary | undefined {
    const session = this.getActiveSession(entityId, type);
    return session ? this.computeSummary(session) : undefined;
  }

  /**
   * 按 entityId 查找内存中活跃的完整 session（含 steps + actions）
   */
  getActiveSession(
    entityId: string,
    type?: string,
  ): LatencySession | undefined {
    for (const session of this.sessions.values()) {
      if (
        session.entityId === entityId &&
        session.status === "running" &&
        (!type || session.type === type)
      ) {
        return session;
      }
    }
    return undefined;
  }

  // ==================== Step Management ====================

  /**
   * 开始一个 Step（业务语义单元）
   */
  startStep(sessionId: string, input: StartStepInput): string {
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.logger.warn(
        `[Step] Session not found: ${sessionId}, step: ${input.name}`,
      );
      return "";
    }

    const stepId = randomUUID();
    const step: LatencyStep = {
      id: stepId,
      name: input.name,
      parentStepId: input.parentStepId,
      startTime: Date.now(),
      parallel: input.parallel,
      parallelCount: input.parallelCount,
      metadata: input.metadata,
      actions: [],
    };

    session.steps.push(step);

    this.logger.debug(
      `[Step] Started: ${input.name} [${stepId}]` +
        (input.parallel ? ` parallel=${input.parallelCount}` : ""),
    );

    return stepId;
  }

  /**
   * 结束一个 Step
   */
  endStep(
    sessionId: string,
    stepId: string,
    metadata?: Record<string, unknown>,
  ): number | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;

    const step = session.steps.find((s) => s.id === stepId);
    if (!step) {
      this.logger.warn(`[Step] Not found: ${stepId}`);
      return undefined;
    }

    const now = Date.now();
    step.endTime = now;
    step.durationMs = now - step.startTime;
    if (metadata) {
      step.metadata = { ...step.metadata, ...metadata };
    }

    this.logger.debug(
      `[Step] Ended: ${step.name} [${stepId}] duration=${step.durationMs}ms actions=${step.actions.length}`,
    );

    return step.durationMs;
  }

  /**
   * 按名称结束 Step
   */
  endStepByName(
    sessionId: string,
    stepName: string,
    metadata?: Record<string, unknown>,
  ): number | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;

    const step = [...session.steps]
      .reverse()
      .find((s) => s.name === stepName && !s.endTime);

    if (!step) {
      this.logger.warn(
        `[Step] No open step named "${stepName}" in session ${sessionId}`,
      );
      return undefined;
    }

    return this.endStep(sessionId, step.id, metadata);
  }

  /**
   * 获取当前最后一个未结束的 Step ID
   */
  getActiveStepId(sessionId: string): string | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    const openStep = [...session.steps].reverse().find((s) => !s.endTime);
    return openStep?.id;
  }

  // ==================== Action Recording ====================

  /**
   * 记录一次 Action（LLM 调用或工具调用）到当前 Step
   */
  recordAction(sessionId: string, input: RecordActionInput): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // 找到目标 Step：显式指定 > 最后一个未结束的 Step
    const stepId = input.stepId ?? this.getActiveStepId(sessionId);
    const step = stepId
      ? session.steps.find((s) => s.id === stepId)
      : undefined;

    // 计算吞吐量
    let tokenThroughputPerSec = 0;
    if (
      input.streaming &&
      input.ttftMs != null &&
      input.ttltMs > input.ttftMs
    ) {
      const generationTimeMs = input.ttltMs - input.ttftMs;
      tokenThroughputPerSec =
        generationTimeMs > 0
          ? (input.outputTokens / generationTimeMs) * 1000
          : 0;
    } else if (input.totalDurationMs > 0) {
      tokenThroughputPerSec =
        (input.outputTokens / input.totalDurationMs) * 1000;
    }

    const action: LatencyAction = {
      id: randomUUID(),
      stepId: stepId ?? "",
      type: input.type ?? "llm_call",
      name: input.name,
      model: input.model,
      provider: input.provider,
      streaming: input.streaming,
      ttftMs: input.ttftMs,
      ttltMs: input.ttltMs,
      totalDurationMs: input.totalDurationMs,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      tokenThroughputPerSec: Math.round(tokenThroughputPerSec * 10) / 10,
      timestamp: Date.now(),
    };

    if (step) {
      step.actions.push(action);
    }
    // find() 搜索所有 step（含已关闭的），所以 closed step 也能接收 action
    // 只有 stepId 为空/undefined 且没有活跃 step 时才丢弃
  }

  // ==================== Legacy API (backward compatible) ====================

  /** @deprecated Use startStep */
  startPhase(sessionId: string, input: StartStepInput): string {
    return this.startStep(sessionId, input);
  }

  /** @deprecated Use endStep */
  endPhase(
    sessionId: string,
    stepId: string,
    metadata?: Record<string, unknown>,
  ): number | undefined {
    return this.endStep(sessionId, stepId, metadata);
  }

  /** @deprecated Use endStepByName */
  endPhaseByName(
    sessionId: string,
    stepName: string,
    metadata?: Record<string, unknown>,
  ): number | undefined {
    return this.endStepByName(sessionId, stepName, metadata);
  }

  /** @deprecated Use getActiveStepId */
  getActivePhaseId(sessionId: string): string | undefined {
    return this.getActiveStepId(sessionId);
  }

  /** @deprecated Use recordAction */
  recordLLMCall(sessionId: string, input: RecordActionInput): void {
    this.recordAction(sessionId, input);
  }

  // ==================== Query ====================

  async listSessions(
    filter: ListSessionsFilter,
  ): Promise<LatencySessionSummary[]> {
    if (!this.prisma) return [];

    const where: Prisma.LatencySessionWhereInput = {};
    if (filter.type) where.type = filter.type;
    if (filter.userId) where.userId = filter.userId;
    if (filter.entityId) where.entityId = filter.entityId;
    if (filter.status) where.status = filter.status;
    if (filter.since) {
      where.startTime = { gte: new Date(filter.since) };
    }

    try {
      const rows = await this.prisma.latencySession.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: filter.limit ?? 50,
        select: { summary: true },
      });

      return rows
        .map((r) => r.summary as unknown as LatencySessionSummary)
        .filter(Boolean);
    } catch (e) {
      this.logger.debug(`[Query] listSessions failed: ${e}`);
      return [];
    }
  }

  async getLatestSummary(
    entityId: string,
    type?: string,
  ): Promise<LatencySessionSummary | undefined> {
    if (!this.prisma) return undefined;

    try {
      const where: Prisma.LatencySessionWhereInput = { entityId };
      if (type) where.type = type;

      const row = await this.prisma.latencySession.findFirst({
        where,
        orderBy: { createdAt: "desc" },
        select: { summary: true },
      });

      return (row?.summary as unknown as LatencySessionSummary) ?? undefined;
    } catch (e) {
      this.logger.debug(`[Query] getLatestSummary failed: ${e}`);
      return undefined;
    }
  }

  // ==================== Helpers ====================

  /** 收集 session 中所有 steps 的所有 actions */
  private getAllActions(session: LatencySession): LatencyAction[] {
    return session.steps.flatMap((s) => s.actions);
  }

  // ==================== Summary Computation ====================

  private computeSummary(session: LatencySession): LatencySessionSummary {
    const totalDurationMs = (session.endTime ?? Date.now()) - session.startTime;
    const allActions = this.getAllActions(session);

    // Step 分解（只取顶层 Step）
    // parentStepId 优先；兼容旧数据通过名称模式排除子步骤（含 "/" 且前缀匹配某个 dimension_research step）
    const dimNames = new Set(
      session.steps
        .filter((s) => s.name.startsWith("dimension_research:"))
        .map((s) => s.name.replace("dimension_research:", "")),
    );
    const topLevelSteps = session.steps.filter((s) => {
      if (s.parentStepId) return false;
      // 兼容旧数据：名称含 "/" 且前缀是已知维度名 → 是子步骤
      if (s.name.includes("/")) {
        const prefix = s.name.split("/")[0];
        if (dimNames.has(prefix)) return false;
      }
      return true;
    });
    const steps: StepSummary[] = topLevelSteps.map((s) => {
      const dur = s.durationMs ?? (s.endTime ? s.endTime - s.startTime : 0);
      const stepActions = s.actions;
      const llmActions = stepActions.filter((a) => a.type === "llm_call");
      const ttltValues = llmActions.map((a) => a.ttltMs).filter((v) => v > 0);
      return {
        name: s.name,
        durationMs: dur,
        percentOfTotal: totalDurationMs > 0 ? (dur / totalDurationMs) * 100 : 0,
        actionCount: stepActions.length,
        avgTtltMs:
          ttltValues.length > 0
            ? Math.round(
                ttltValues.reduce((sum, v) => sum + v, 0) / ttltValues.length,
              )
            : undefined,
      };
    });

    // LLM action 聚合
    const llmActions = allActions.filter((a) => a.type === "llm_call");
    const llmCallCount = llmActions.length;
    const llmTotalTimeMs = llmActions.reduce(
      (sum, a) => sum + a.totalDurationMs,
      0,
    );
    const llmTimePercent =
      totalDurationMs > 0 ? (llmTotalTimeMs / totalDurationMs) * 100 : 0;
    const overheadMs = Math.max(0, totalDurationMs - llmTotalTimeMs);

    // TTFT 统计
    const ttft = this.computePercentileStats(
      llmActions
        .filter((a) => a.streaming && a.ttftMs != null)
        .map((a) => a.ttftMs!),
    );

    // TTLT 统计
    const ttlt = this.computePercentileStats(
      llmActions.map((a) => a.ttltMs).filter((v) => v > 0),
    );

    // Token 统计
    const totalInputTokens = llmActions.reduce(
      (sum, a) => sum + a.inputTokens,
      0,
    );
    const totalOutputTokens = llmActions.reduce(
      (sum, a) => sum + a.outputTokens,
      0,
    );
    const throughputs = llmActions
      .map((a) => a.tokenThroughputPerSec)
      .filter((t) => t > 0);
    const avgTokenThroughput =
      throughputs.length > 0
        ? Math.round(
            (throughputs.reduce((s, v) => s + v, 0) / throughputs.length) * 10,
          ) / 10
        : 0;

    return {
      sessionId: session.id,
      type: session.type,
      status: session.status,
      totalDurationMs,
      steps,
      llmCallCount,
      llmTotalTimeMs,
      llmTimePercent: Math.round(llmTimePercent * 10) / 10,
      overheadMs,
      ttft,
      ttlt,
      totalInputTokens,
      totalOutputTokens,
      avgTokenThroughput,
    };
  }

  private computePercentileStats(
    values: number[],
  ): LatencyPercentileStats | undefined {
    if (values.length === 0) return undefined;
    const sorted = [...values].sort((a, b) => a - b);
    return {
      avgMs:
        Math.round((sorted.reduce((s, v) => s + v, 0) / sorted.length) * 10) /
        10,
      p50Ms: this.percentile(sorted, 50),
      p95Ms: this.percentile(sorted, 95),
      minMs: sorted[0],
      maxMs: sorted[sorted.length - 1],
    };
  }

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
  }

  // ==================== Persistence ====================

  private async persistSession(
    session: LatencySession,
    summary: LatencySessionSummary,
  ): Promise<void> {
    if (!this.prisma) return;

    try {
      await this.prisma.latencySession.create({
        data: {
          id: session.id,
          type: session.type,
          status: session.status,
          userId: session.userId,
          entityId: session.entityId,
          startTime: new Date(session.startTime),
          endTime: session.endTime ? new Date(session.endTime) : null,
          durationMs: summary.totalDurationMs,
          summary: JSON.parse(JSON.stringify(summary)) as Prisma.InputJsonValue,
          // steps 包含 actions，完整保存
          phases: JSON.parse(
            JSON.stringify(session.steps),
          ) as Prisma.InputJsonValue,
          // llmCalls 字段保存扁平化的 actions（兼容前端查询）
          llmCalls: JSON.parse(
            JSON.stringify(this.getAllActions(session)),
          ) as Prisma.InputJsonValue,
        },
      });
    } catch (e) {
      this.logger.warn(`[Persist] Failed to save session ${session.id}: ${e}`);
    }
  }
}
