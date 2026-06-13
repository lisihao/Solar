/**
 * RadarMissionStore —— RadarRun 表的 CRUD + mission lifecycle 状态机
 *
 * 与 playground/MissionStore 同构（structural typing 满足
 * IBusinessTeamMissionStore），让 ai-harness liveness-guard / runtime-shell
 * 框架可以正常工作。
 *
 * 状态转换（VarChar 字段值，小写）：
 *   running    : create() 默认 / runtime-shell.openSession 写入
 *   completed  : markCompleted()
 *   failed     : markFailed()
 *   cancelled  : markCancelled()
 *   rejected   : markRejected()（budget 预检拒绝等）
 *
 * Liveness guard 扫描（harness）：where status='running' AND heartbeat_at<stale_cutoff
 */
import { ConflictException, Injectable } from "@nestjs/common";
import { Prisma, RadarRun, RadarRunTrigger } from "@prisma/client";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  MissionFailureCode,
  type MissionTerminalArbiter,
  type MissionTerminalIntent,
} from "@/modules/ai-harness/facade";
import type { RadarConfigSnapshot } from "./radar-mission-config-snapshot";

export type RadarMissionStatus =
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "rejected";

/**
 * ★ C0/G1：radar 终态 arbiter 富载荷（判别式）。dispatcher/controller/liveness 经
 * MissionLifecycleManager.finalize 提交 intent，arbiter 据 kind 落 radar 业务终态。
 * 平台 3 终态(completed/failed/cancelled)外 radar 多一个业务态 `rejected`（budget 预检拒绝），
 * 平台层映射为 status='failed'(outcome=failure，G6)，DB 落 'rejected' 保业务细分。
 */
export type RadarTerminalExtra =
  | { readonly kind: "completed"; readonly metrics: Record<string, unknown> }
  | { readonly kind: "failed"; readonly error: string }
  | { readonly kind: "cancelled"; readonly reason?: string }
  | { readonly kind: "rejected"; readonly reason: string };

export interface RadarMissionCreateInput {
  readonly id: string;
  readonly topicId: string;
  readonly userId: string;
  readonly workspaceId?: string;
  readonly trigger: RadarRunTrigger;
  readonly maxCredits: number;
  readonly wallTimeCapMs: number;
  readonly payload: Record<string, unknown>;
  /** ★ C5/G7（三 app 统一）：typed MissionConfigSnapshot(canonical 配置记录)。 */
  readonly configSnapshot?: RadarConfigSnapshot;
}

@Injectable()
export class RadarMissionStore implements MissionTerminalArbiter<RadarTerminalExtra> {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * ★ C0/G1：唯一终态写仲裁口。所有终态来源（dispatcher 完成/失败/取消/拒绝、
   * controller 取消、liveness 回收）经 MissionLifecycleManager.finalize 提交 intent，
   * 由此单点条件写（WHERE status='running'）首写者赢。返回 true=本次赢、false=已终态 no-op。
   */
  async applyTerminalIfRunning(
    missionId: string,
    intent: MissionTerminalIntent<RadarTerminalExtra>,
  ): Promise<boolean> {
    const extra = intent.extra;
    if (!extra) return false; // 防御：radar 终态必须带 extra（理论不可达）
    switch (extra.kind) {
      case "completed":
        return this.writeCompleted(missionId, extra.metrics);
      case "failed":
        return this.writeFailed(missionId, extra.error, intent.failureCode);
      case "cancelled":
        return this.writeCancelled(missionId, extra.reason);
      case "rejected":
        return this.writeRejected(missionId, extra.reason);
    }
  }

  /**
   * Atomic acquire run slot：同 topic 只能有 1 个 status='running' 的 mission。
   * 在事务内 inflight check + create，避免 controller race。
   *
   * @throws ConflictException 已有 inflight
   */
  async createAtomic(input: RadarMissionCreateInput): Promise<RadarRun> {
    return this.prisma.$transaction(async (tx) => {
      const inflight = await tx.radarRun.findFirst({
        where: { topicId: input.topicId, status: "running" },
        select: { id: true },
      });
      if (inflight) {
        throw new ConflictException({
          message: "已有 mission 正在执行",
          runId: inflight.id,
        });
      }
      return tx.radarRun.create({
        data: {
          id: input.id,
          topicId: input.topicId,
          userId: input.userId,
          workspaceId: input.workspaceId ?? null,
          status: "running",
          trigger: input.trigger,
          startedAt: new Date(),
          maxCredits: input.maxCredits,
          wallTimeCapMs: input.wallTimeCapMs,
          payload: input.payload as Prisma.InputJsonValue,
          configSnapshot: input.configSnapshot as
            | Prisma.InputJsonValue
            | undefined,
        },
      });
    });
  }

  async refreshHeartbeat(missionId: string, podId: string): Promise<void> {
    // 不存在的 mission 静默忽略 —— mission 可能已被 cleanup 删，liveness 定时器晚到
    await this.prisma.radarRun.updateMany({
      where: { id: missionId, status: "running" },
      data: { heartbeatAt: new Date(), podId },
    });
  }

  /**
   * Liveness 扫描用：列出所有 running mission 的存活字段。
   * 供 RadarModule onModuleInit 注册的 MissionLivenessGuard adapter 调用——
   * ★ 2026-05-22 C8：radar 之前漏注册 liveness adapter，heartbeatAt 写了没人扫 →
   *   孤儿 running 行永不回收。本方法 + 注册补上这条扫描链。
   */
  async fetchRunningForLiveness(): Promise<
    Array<{
      id: string;
      userId: string;
      startedAt: Date;
      heartbeatAt: Date | null;
    }>
  > {
    const rows = await this.prisma.radarRun.findMany({
      where: { status: "running" },
      select: { id: true, userId: true, startedAt: true, heartbeatAt: true },
      take: 200,
    });
    // startedAt 在 createAtomic 时必写，schema 列可空仅历史遗留 → 兜底 heartbeatAt/now
    return rows.map((r) => ({
      ...r,
      startedAt: r.startedAt ?? r.heartbeatAt ?? new Date(),
    }));
  }

  // ★ C0/G1：以下 4 个 writeX 是 arbiter 私有落库实现，仅 applyTerminalIfRunning 调用。
  //   外部一律经 finalize → applyTerminalIfRunning，禁止直写终态（conformance 看护）。
  //   均为条件写 WHERE status='running'（首写赢），返回 count>0=本次赢。
  private async writeCompleted(
    missionId: string,
    metrics: Record<string, unknown>,
  ): Promise<boolean> {
    const now = new Date();
    const run = await this.prisma.radarRun.findUnique({
      where: { id: missionId },
      select: { startedAt: true },
    });
    const startedAt = run?.startedAt ?? now;
    const durationMs = now.getTime() - startedAt.getTime();
    const res = await this.prisma.radarRun.updateMany({
      where: { id: missionId, status: "running" },
      data: {
        status: "completed",
        completedAt: now,
        durationMs,
        metrics: metrics as Prisma.InputJsonValue,
        error: null,
      },
    });
    return res.count > 0;
  }

  private async writeFailed(
    missionId: string,
    error: string,
    failureCodeOverride?: MissionFailureCode,
  ): Promise<boolean> {
    const now = new Date();
    const run = await this.prisma.radarRun.findUnique({
      where: { id: missionId },
      select: { startedAt: true },
    });
    const startedAt = run?.startedAt ?? now;
    const durationMs = now.getTime() - startedAt.getTime();
    // ★ C2/G3 + MAJOR-3/7：调用方知道 abort reason 时传 canonical code(精确);
    //   否则退回 message→code 启发式。
    const failureCode =
      failureCodeOverride ??
      (/budget|exhaust/i.test(error)
        ? MissionFailureCode.budget_exhausted
        : /timeout|timed out|wall.?time/i.test(error)
          ? MissionFailureCode.wall_time_exceeded
          : MissionFailureCode.provider_error);
    const res = await this.prisma.radarRun.updateMany({
      where: { id: missionId, status: "running" },
      data: {
        status: "failed",
        completedAt: now,
        durationMs,
        error: error.slice(0, 4000),
        failureCode,
      },
    });
    return res.count > 0;
  }

  private async writeCancelled(
    missionId: string,
    reason?: string,
  ): Promise<boolean> {
    const now = new Date();
    const run = await this.prisma.radarRun.findUnique({
      where: { id: missionId },
      select: { startedAt: true },
    });
    const startedAt = run?.startedAt ?? now;
    const durationMs = now.getTime() - startedAt.getTime();
    const res = await this.prisma.radarRun.updateMany({
      where: { id: missionId, status: "running" },
      data: {
        status: "cancelled",
        completedAt: now,
        durationMs,
        error: reason?.slice(0, 4000) ?? null,
        failureCode: MissionFailureCode.user_cancelled,
      },
    });
    return res.count > 0;
  }

  /**
   * mission rejected — budget 预检拒绝 / 入口限额 / framework 层 reject。
   * 不消耗用户额度（已 reject = 没真跑），故 metrics/error 简记。
   * 平台层 outcome=failure（G6），DB 落 'rejected' 保业务细分；与 RUN_FAILED 区分供运维/前端。
   */
  private async writeRejected(
    missionId: string,
    reason: string,
  ): Promise<boolean> {
    const now = new Date();
    const run = await this.prisma.radarRun.findUnique({
      where: { id: missionId },
      select: { startedAt: true },
    });
    const startedAt = run?.startedAt ?? now;
    const durationMs = now.getTime() - startedAt.getTime();
    const res = await this.prisma.radarRun.updateMany({
      where: { id: missionId, status: "running" },
      data: {
        status: "rejected",
        completedAt: now,
        durationMs,
        error: reason.slice(0, 4000),
        // reject = budget 预检/限额拒绝 → canonical budget_exhausted
        failureCode: MissionFailureCode.budget_exhausted,
      },
    });
    return res.count > 0;
  }

  async getById(missionId: string, userId: string): Promise<RadarRun | null> {
    const row = await this.prisma.radarRun.findUnique({
      where: { id: missionId },
    });
    if (!row) return null;
    if (row.userId !== userId) return null;
    return row;
  }

  /**
   * 列出 topic 下的 mission 历史。必须传 userId，防 controller / 上层调用方
   * 误用绕过 ownership（reviewer P0 整改）。
   * 同时 select 排除 payload 字段（含用户输入快照，audit 列表不需要）。
   */
  async listByTopic(
    topicId: string,
    userId: string,
    limit = 20,
  ): Promise<RadarRun[]> {
    return this.prisma.radarRun.findMany({
      where: { topicId, userId },
      orderBy: { startedAt: "desc" },
      take: Math.min(limit, 100),
    });
  }

  async updateLastCompletedStage(
    missionId: string,
    stage: number,
  ): Promise<void> {
    await this.prisma.radarRun.updateMany({
      where: { id: missionId, status: "running" },
      data: { lastCompletedStage: stage },
    });
  }

  async updateMetrics(
    missionId: string,
    metrics: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.radarRun.update({
      where: { id: missionId },
      data: { metrics: metrics as Prisma.InputJsonValue },
    });
  }
}
