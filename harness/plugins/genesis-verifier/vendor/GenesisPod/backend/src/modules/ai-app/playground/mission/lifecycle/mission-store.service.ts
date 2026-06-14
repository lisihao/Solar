/**
 * MissionStore — playground mission 持久化（委托入口）
 *
 * ★ 2026-05-08 PR-E2: satisfies IBusinessTeamMissionStore（structural typing）
 * ★ PR-D-2 (2026-05-15): god-class 拆分到 4 helper，本文件仅保留
 *   constructor / 核心 CRUD / heartbeat / stage / query + thin delegation。
 *   Helper 均为普通 class（非 @Injectable），constructor 内 new，外部接口零变化。
 */

import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  PayloadTooLargeException,
} from "@nestjs/common";
import type { ContentVisibility, Prisma } from "@prisma/client";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { EmbeddingService } from "@/modules/ai-engine/facade";
import {
  BusinessTeamMissionStoreFramework,
  MissionAbortRegistry,
  MissionAbortReason,
  outcomeFromStatus,
  type MissionStoreHooks,
  type MissionTerminalOutcome,
  type MissionTerminalArbiter,
  type MissionTerminalIntent,
} from "@/modules/ai-harness/facade";
import type { PlaygroundConfigSnapshot } from "../../runtime/playground.input-rebuilder";
import { MissionLifecycleHelper } from "./mission-lifecycle.helper";
import { CHECKPOINT_KEY } from "./prisma-mission-checkpoint.store";

/**
 * 每用户最多并发 running mission 数。
 * 单一源：controller 预检（快速 400 UX）+ createMission 原子兜底（堵 TOCTOU race）共用。
 */
export const MAX_CONCURRENT_RUNNING_MISSIONS = 3;

/**
 * createMission 在 advisory-lock 事务内复核仍超并发上限时抛此错误。
 * H4/E9 (2026-05-25)：controller 的 count→create 隔着 async 边界有 TOCTOU race，
 * 两个并发请求可双双过预检 → 绕过限制。此错误是 DB 层原子兜底命中的信号。
 */
export class MissionConcurrencyLimitError extends Error {
  constructor(public readonly running: number) {
    super(
      `已有 ${running} 个 mission 正在运行，最多同时运行 ${MAX_CONCURRENT_RUNNING_MISSIONS} 个`,
    );
    this.name = "MissionConcurrencyLimitError";
  }
}

/**
 * ★ C5/G7 S4b:userProfile 退化为 configSnapshot 的**读时投影**(单一真源=snapshot,
 * 不再独立写 userProfile)。前端 Mission 设置弹窗读此 shape 不变;legacy 无 snapshot → null。
 */
function projectUserProfileView(
  configSnapshot: unknown,
): Record<string, unknown> | null {
  const snap = configSnapshot as PlaygroundConfigSnapshot | null;
  if (snap?.schemaVersion == null) return null;
  const b = snap.businessInput;
  return {
    description: b.description,
    depth: b.depth,
    language: snap.language,
    budgetProfile: b.budgetProfile,
    styleProfile: b.styleProfile,
    lengthProfile: b.lengthProfile,
    audienceProfile: b.audienceProfile,
    withFigures: b.withFigures,
    auditLayers: b.auditLayers,
    concurrency: b.concurrency,
    viewMode: b.viewMode,
    searchTimeRange: b.searchTimeRange,
    knowledgeBaseIds: b.knowledgeBaseIds,
    inheritFromMissionId: b.inheritFromMissionId,
    maxCredits: snap.budget.maxCredits,
    budgetMultiplierOverride: snap.budget.budgetMultiplier,
    wallTimeCapMs: snap.runtimeLimits.wallTimeCapMs,
  };
}
import { MissionUpdateHelper } from "./mission-update.helper";
import { MissionPostmortemHelper } from "./mission-postmortem.helper";
import { MissionReportHelper } from "./mission-report.helper";
import {
  CostLedgerStore,
  type CostLedgerEntry,
  type CostLedgerRow,
  type CostLedgerSummary,
} from "./cost-ledger.store";

export interface MissionListItem {
  id: string;
  topic: string;
  depth: string;
  language: string;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  elapsedWallTimeMs: number | null;
  finalScore: number | null;
  tokensUsed: number | null;
  costUsd: number | null;
  reportTitle: string | null;
  reportSummary: string | null;
  errorMessage: string | null;
  visibility: ContentVisibility;
}

export interface MissionDetail extends MissionListItem {
  /** ★ C7:平台终态 outcome(status 投影,非终态 null)。 */
  terminalOutcome: MissionTerminalOutcome | null;
  /** ★ C2:canonical failure code(失败时)。 */
  failureCode: string | null;
  /** ★ C5/G7:typed MissionConfigSnapshot(单一 config 真源;rerun/hydrate 读它)。NULL=legacy。 */
  configSnapshot: unknown;
  maxCredits: number;
  themeSummary: string | null;
  dimensions: unknown;
  reportFull: unknown;
  verdicts: unknown;
  trajectoryStored: number | null;
  reportArtifactVersion: number | null;
  userProfile: unknown;
  reconciliationReport: unknown;
  leaderJournal: unknown;
  leaderOverallScore: number | null;
  leaderSigned: boolean | null;
  leaderVerdict: string | null;
  lastCompletedStage?: number | null;
  outlinePlan?: unknown;
  analystOutput?: unknown;
  heartbeatAt?: Date | null;
}

// Re-export for existing importers that depend on this symbol from this module path.
export { PayloadTooLargeException };

/**
 * ★ C0/G1：playground 终态 arbiter 富载荷（判别式）。所有终态来源（S11、dispatcher
 * handleMissionFailure、rerun 路径、liveness 回收、controller cancel）经
 * MissionLifecycleManager.finalize 提交 intent，arbiter 据 kind 落终态。
 *
 * userId 透传给 writeX 的 ownership WHERE（WHERE status='running' AND userId=userId）。
 */
export type PlaygroundTerminalExtra =
  | {
      readonly kind: "completed";
      readonly detail: Parameters<MissionLifecycleHelper["writeCompleted"]>[1];
      readonly userId?: string;
    }
  | {
      readonly kind: "failed";
      readonly detail: Parameters<MissionLifecycleHelper["writeFailed"]>[1];
      readonly userId?: string;
    }
  | { readonly kind: "cancelled"; readonly userId?: string };

/** Mission create input shape（playground 业务字段）。 */
interface PlaygroundMissionCreateInput {
  readonly id: string;
  readonly userId: string;
  readonly workspaceId?: string;
  readonly topic: string;
  readonly depth: string;
  readonly language: string;
  readonly maxCredits: number;
  readonly userProfile?: Record<string, unknown>;
  readonly configSnapshot?: PlaygroundConfigSnapshot;
}

@Injectable()
export class MissionStore
  extends BusinessTeamMissionStoreFramework<PlaygroundMissionCreateInput>
  implements MissionTerminalArbiter<PlaygroundTerminalExtra>
{
  private readonly storeLog = new Logger(MissionStore.name);

  private readonly lifecycle: MissionLifecycleHelper;
  private readonly update: MissionUpdateHelper;
  private readonly postmortem: MissionPostmortemHelper;
  private readonly report: MissionReportHelper;
  private readonly costLedger: CostLedgerStore;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() embeddingService?: EmbeddingService,
    @Optional() abortRegistry?: MissionAbortRegistry,
  ) {
    // Forward references — defined methods on class instance; safe at hook-call time.
    const isMissionRowMissing = (err: unknown): boolean => {
      if (!err || typeof err !== "object") return false;
      const code = (err as { code?: string }).code;
      return code === "P2003" || code === "P2025";
    };
    const emergencyAbort = (missionId: string): void => {
      abortRegistry?.abort(missionId, MissionAbortReason.mission_row_missing);
    };
    const hooks: MissionStoreHooks<PlaygroundMissionCreateInput> = {
      loggerNamespace: MissionStore.name,
      isMissionRowMissing,
      emergencyAbort,
      createMission: async (input) => {
        // ★ H4/E9 (2026-05-25): count + insert 必须原子，否则两个并发请求都过
        //   controller 预检 → 双双建行 → 绕过 <3 限制。用 per-user Postgres
        //   advisory xact lock 串行化同一用户建行：拿锁 → tx 内 count（看得到
        //   已提交行）→ 超限抛 MissionConcurrencyLimitError → 否则 insert。
        //   advisory_xact_lock 随事务结束自动释放；不同用户 hash key 不同不互阻。
        await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`apmission:${input.userId}`}))`;
          const running = await tx.agentPlaygroundMission.count({
            where: { userId: input.userId, status: "running" },
          });
          if (running >= MAX_CONCURRENT_RUNNING_MISSIONS) {
            throw new MissionConcurrencyLimitError(running);
          }
          await tx.agentPlaygroundMission.create({
            data: {
              id: input.id,
              userId: input.userId,
              workspaceId: input.workspaceId,
              topic: input.topic.slice(0, 500),
              depth: input.depth,
              language: input.language,
              maxCredits: input.maxCredits,
              status: "running",
              // ★ S4b:不再写 userProfile(configSnapshot 单一真源;读时投影回 userProfile shape)。
              configSnapshot: input.configSnapshot as
                | Prisma.InputJsonValue
                | undefined,
            },
          });
        });
      },
      writeHeartbeat: async (missionId, podId) => {
        await prisma.agentPlaygroundMission.update({
          where: { id: missionId },
          data: { heartbeatAt: new Date(), podId },
        });
      },
      resetHeartbeat: async (missionId, userId) => {
        await prisma.agentPlaygroundMission.updateMany({
          where: { id: missionId, userId },
          data: { heartbeatAt: null },
        });
      },
      findOrphanRunning: async (cutoff, limit) => {
        const orphans = await prisma.agentPlaygroundMission.findMany({
          where: { status: "running", heartbeatAt: { lt: cutoff } },
          select: { id: true, userId: true },
          take: limit,
        });
        return orphans;
      },
      // ★ P-DUR2 (2026-05-30): 多 pod 安全的原子认领单个 orphan。条件写
      //   WHERE id + status='running'：DB 保证 N pod 并发只有一个命中 1 行（赢家），
      //   其余命中 0 行。只有 count===1 的 pod 被授权续跑（rerun），消除重复烧 credit。
      claimOrphanFailed: async (missionId) => {
        const { count } = await prisma.agentPlaygroundMission.updateMany({
          where: { id: missionId, status: "running" },
          data: {
            status: "failed",
            completedAt: new Date(),
            failureCode: "runtime_crashed",
            errorMessage:
              "Mission 在执行中遇到后端重启或异常退出（dispatcher 内存丢失）。" +
              "已自动标记为失败，建议在左侧操作区点「开始」重跑相同主题（存在断点时按钮显示「继续上次」可续跑）。",
          },
        });
        return count === 1;
      },
      writeStageProgress: async (missionId, stageNumber) => {
        await prisma.agentPlaygroundMission.updateMany({
          where: { id: missionId, status: "running" },
          data: { lastCompletedStage: stageNumber, heartbeatAt: new Date() },
        });
      },
      countRunning: async (userId) =>
        prisma.agentPlaygroundMission.count({
          where: { userId, status: "running" },
        }),
    };
    super(hooks);

    this.lifecycle = new MissionLifecycleHelper(
      prisma,
      isMissionRowMissing,
      (missionId, reason) => this.triggerEmergencyAbort(missionId, reason),
      this.clearCheckpointJsonbKey.bind(this),
    );
    this.update = new MissionUpdateHelper(prisma);
    this.postmortem = new MissionPostmortemHelper(prisma, embeddingService);
    this.report = new MissionReportHelper(
      prisma,
      isMissionRowMissing,
      (missionId, reason) => this.triggerEmergencyAbort(missionId, reason),
    );
    this.costLedger = new CostLedgerStore(prisma);
  }

  /**
   * 当前用户最旧的 running mission id（createdAt 升序首个），无则 null。
   * auto-supersede 用：撞并发上限时顶替最旧，让用户新建不被 400 卡死。
   */
  async findOldestRunningMissionId(userId: string): Promise<string | null> {
    const row = await this.prisma.agentPlaygroundMission.findFirst({
      where: { userId, status: "running" },
      orderBy: { startedAt: "asc" },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  private async clearCheckpointJsonbKey(missionId: string): Promise<void> {
    await this.prisma.$executeRaw`
        UPDATE agent_playground_missions
        SET leader_journal = COALESCE(leader_journal, '{}'::jsonb) - ${CHECKPOINT_KEY}
        WHERE id = ${missionId}
          AND leader_journal ? ${CHECKPOINT_KEY}
      `.catch((err: unknown) => {
      this.storeLog.error(
        `[clearCheckpoint ${missionId}] update failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 0;
    });
  }

  // ── Arbiter (C0/G1 唯一终态写入口) ───────────────────────────────────────

  /**
   * ★ C0/G1：唯一终态写仲裁口。所有终态来源经 MissionLifecycleManager.finalize
   * 提交 intent，由此单点条件写（WHERE status='running'）首写者赢。
   * 返回 true=本次赢、false=已终态 no-op。
   */
  async applyTerminalIfRunning(
    missionId: string,
    intent: MissionTerminalIntent<PlaygroundTerminalExtra>,
  ): Promise<boolean> {
    const extra = intent.extra;
    if (!extra) return false; // 防御：playground 终态必须带 extra（理论不可达）
    switch (extra.kind) {
      case "completed":
        return this.lifecycle.writeCompleted(
          missionId,
          await this.reconcileTerminalCost(missionId, extra.detail),
          extra.userId,
        );
      case "failed":
        return this.lifecycle.writeFailed(
          missionId,
          await this.reconcileTerminalCost(missionId, extra.detail),
          extra.userId,
        );
      case "cancelled":
        return this.lifecycle.writeCancelled(missionId, extra.userId);
    }
  }

  /**
   * ★ Wire-Cost (2026-05-30)：终态 costUsd/tokensUsed 改取成本台账 SUM（DB 端权威值），
   * 替代 budget pool 标量快照漂移。台账有行 → 覆盖；无行（legacy / 无 LLM 结算）→
   * 保留调用方传入的标量，保证向后兼容不丢值。
   */
  private async reconcileTerminalCost<
    T extends { tokensUsed?: number; costUsd?: number },
  >(missionId: string, detail: T): Promise<T> {
    const summary = await this.costLedger.sumByMission(missionId);
    if (summary.entryCount === 0) return detail; // 无台账留痕：回退标量，不覆盖
    return {
      ...detail,
      tokensUsed: summary.totalTokens,
      costUsd: summary.costUsd,
    };
  }

  // ── Cost ledger delegates (Wire-Cost) ─────────────────────────────────────

  /** stage / role 结算点追加一行成本台账（fire-and-forget；失败结构化 warn 不吞错）。 */
  appendCostEntry(entry: CostLedgerEntry): Promise<boolean> {
    return this.costLedger.appendCostEntry(entry);
  }

  /** 单 mission 成本求和（终态 costUsd/tokensUsed 取此值）。 */
  sumCostByMission(missionId: string): Promise<CostLedgerSummary> {
    return this.costLedger.sumByMission(missionId);
  }

  /** 单 mission 成本明细（per-stage/role/model 列行，供审计 / 成本面板）。 */
  listCostByMission(missionId: string): Promise<CostLedgerRow[]> {
    return this.costLedger.listByMission(missionId);
  }

  /**
   * 进度门控用：mission 在 windowMs 内是否有事件产出（= 真实前进进度）。
   *
   * ★ 2026-06-11 修"mission 卡死永不收尾"(实测 14.5h)：心跳刷新据此门控。
   *   背景——心跳此前由 shell 的盲 30s 计时器无条件刷新，只要进程活着就刷，
   *   **与是否在前进无关**。于是卡在某 stage（无事件产出）的 mission 心跳永远
   *   新鲜 → LivenessGuard 的"心跳 AND 事件双 stale>15min"路径永不触发 →
   *   永久卡 running，只能等 4h 墙钟（且墙钟亦可能被 reopen 规避）。
   *   改为：心跳仅在近期有事件时才刷，无进度则随事件一同老化，guard 正确回收。
   *   读的是 guard 同一进度真值（events 表），语义对齐、零新状态。
   *   事件表 (missionId, ts) 有联合索引，count 走索引、开销极小。
   */
  async hasRecentEvent(missionId: string, windowMs: number): Promise<boolean> {
    const since = BigInt(Date.now() - windowMs);
    const count = await this.prisma.agentPlaygroundMissionEvent.count({
      where: { missionId, ts: { gte: since } },
    });
    return count > 0;
  }

  // ── CRUD / heartbeat / stage / orphan: framework 已提供
  //    refreshHeartbeat / clearHeartbeat / markStageComplete /
  //    cleanupOrphanRunningMissionsAtomic / countRunningByUser / create
  // ──────────────────────────────────────────────────────────────────────────

  // ── Lifecycle delegates ───────────────────────────────────────────────────
  // ★ C0/G1：markCompleted / markCancelled / markFailed 已折叠进 arbiter 的
  //   applyTerminalIfRunning——外部经 finalize → applyTerminalIfRunning 提交终态。

  markReopened(
    ...args: Parameters<MissionLifecycleHelper["markReopened"]>
  ): ReturnType<MissionLifecycleHelper["markReopened"]> {
    return this.lifecycle.markReopened(...args);
  }
  appendLeaderJournal(
    ...args: Parameters<MissionLifecycleHelper["appendLeaderJournal"]>
  ): ReturnType<MissionLifecycleHelper["appendLeaderJournal"]> {
    return this.lifecycle.appendLeaderJournal(...args);
  }

  // ── Update delegates ──────────────────────────────────────────────────────

  updateTopicByUser(
    ...args: Parameters<MissionUpdateHelper["updateTopicByUser"]>
  ): ReturnType<MissionUpdateHelper["updateTopicByUser"]> {
    return this.update.updateTopicByUser(...args);
  }
  updateBudgetByUser(
    ...args: Parameters<MissionUpdateHelper["updateBudgetByUser"]>
  ): ReturnType<MissionUpdateHelper["updateBudgetByUser"]> {
    return this.update.updateBudgetByUser(...args);
  }
  resetFields(
    ...args: Parameters<MissionUpdateHelper["resetFields"]>
  ): ReturnType<MissionUpdateHelper["resetFields"]> {
    return this.update.resetFields(...args);
  }
  markRerunPatch(
    ...args: Parameters<MissionUpdateHelper["markRerunPatch"]>
  ): ReturnType<MissionUpdateHelper["markRerunPatch"]> {
    return this.update.markRerunPatch(...args);
  }
  markIntermediateState(
    ...args: Parameters<MissionUpdateHelper["markIntermediateState"]>
  ): ReturnType<MissionUpdateHelper["markIntermediateState"]> {
    return this.update.markIntermediateState(...args);
  }

  // ── Postmortem delegates ──────────────────────────────────────────────────

  recordMissionPostmortem(
    ...args: Parameters<MissionPostmortemHelper["recordMissionPostmortem"]>
  ): ReturnType<MissionPostmortemHelper["recordMissionPostmortem"]> {
    return this.postmortem.recordMissionPostmortem(...args);
  }
  listRecentPostmortems(
    ...args: Parameters<MissionPostmortemHelper["listRecentPostmortems"]>
  ): ReturnType<MissionPostmortemHelper["listRecentPostmortems"]> {
    return this.postmortem.listRecentPostmortems(...args);
  }

  // ── Report delegates ──────────────────────────────────────────────────────

  saveReportVersion(
    ...args: Parameters<MissionReportHelper["saveReportVersion"]>
  ): ReturnType<MissionReportHelper["saveReportVersion"]> {
    return this.report.saveReportVersion(...args);
  }
  listReportVersions(
    ...args: Parameters<MissionReportHelper["listReportVersions"]>
  ): ReturnType<MissionReportHelper["listReportVersions"]> {
    return this.report.listReportVersions(...args);
  }
  getReportVersion(
    ...args: Parameters<MissionReportHelper["getReportVersion"]>
  ): ReturnType<MissionReportHelper["getReportVersion"]> {
    return this.report.getReportVersion(...args);
  }
  saveResearchResult(
    ...args: Parameters<MissionReportHelper["saveResearchResult"]>
  ): ReturnType<MissionReportHelper["saveResearchResult"]> {
    return this.report.saveResearchResult(...args);
  }
  loadBaselineResearchResults(
    ...args: Parameters<MissionReportHelper["loadBaselineResearchResults"]>
  ): ReturnType<MissionReportHelper["loadBaselineResearchResults"]> {
    return this.report.loadBaselineResearchResults(...args);
  }
  saveChapterDraft(
    ...args: Parameters<MissionReportHelper["saveChapterDraft"]>
  ): ReturnType<MissionReportHelper["saveChapterDraft"]> {
    return this.report.saveChapterDraft(...args);
  }
  loadQualifiedChapterDrafts(
    ...args: Parameters<MissionReportHelper["loadQualifiedChapterDrafts"]>
  ): ReturnType<MissionReportHelper["loadQualifiedChapterDrafts"]> {
    return this.report.loadQualifiedChapterDrafts(...args);
  }

  // ── Query ─────────────────────────────────────────────────────────────────
  // countRunningByUser: framework 已提供

  async deleteByUser(id: string, userId: string): Promise<void> {
    await this.prisma.agentPlaygroundMission
      .deleteMany({ where: { id, userId } })
      .catch((err: unknown) => {
        this.storeLog.warn(
          `[deleteByUser ${id}] failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }

  /**
   * 批量删除当前用户"已结束失败类" mission（failed / quality-failed / cancelled）。
   *
   * ★ 2026-06-11 一键清理：列表头「清理已结束」用。状态白名单**服务端硬编码**——
   *   绝不含 running（删 running 会让 background worker 撞 FK，见 deleteMission）、
   *   也不含 completed（保留报告）。返回删除条数供前端提示。
   */
  async deleteTerminalByUser(userId: string): Promise<number> {
    const res = await this.prisma.agentPlaygroundMission
      .deleteMany({
        where: {
          userId,
          status: { in: ["failed", "quality-failed", "cancelled"] },
        },
      })
      .catch((err: unknown) => {
        this.storeLog.warn(
          `[deleteTerminalByUser ${userId}] failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        return { count: 0 };
      });
    return res.count;
  }

  async appendDimensions(
    missionId: string,
    items: { name: string; rationale: string }[],
  ): Promise<string[]> {
    if (items.length === 0) return [];
    return this.prisma.$transaction(
      async (tx) => {
        const row = await tx.agentPlaygroundMission.findUnique({
          where: { id: missionId },
          select: { status: true, dimensions: true },
        });
        if (!row || row.status !== "running") {
          this.storeLog.warn(
            `[appendDimensions ${missionId}] mission status=${row?.status ?? "missing"} — refusing append`,
          );
          return [];
        }
        const existing = (row.dimensions ?? []) as {
          id: string;
          name: string;
          rationale: string;
          source?: string;
        }[];
        const baseIdx = existing.length;
        const newDims = items.map((it, i) => ({
          id: `dim-user-${baseIdx + i + 1}`,
          name: it.name
            .replace(/[\r\n]/g, " ")
            .trim()
            .slice(0, 80),
          rationale: it.rationale
            .replace(/[\r\n]/g, " ")
            .trim()
            .slice(0, 500),
          source: "user-chat" as const,
        }));
        await tx.agentPlaygroundMission.update({
          where: { id: missionId },
          data: { dimensions: [...existing, ...newDims] as never },
        });
        return newDims.map((d) => d.id);
      },
      { isolationLevel: "Serializable" },
    );
  }

  /** 多租户可见性切换（仅所有者）。 */
  async updateVisibility(
    userId: string,
    missionId: string,
    visibility: ContentVisibility,
  ): Promise<{ id: string; visibility: ContentVisibility }> {
    const row = await this.prisma.agentPlaygroundMission.findFirst({
      where: { id: missionId },
      select: { userId: true },
    });
    if (!row) throw new NotFoundException("Mission not found");
    if (row.userId !== userId) throw new ForbiddenException("Not owner");
    return this.prisma.agentPlaygroundMission.update({
      where: { id: missionId },
      data: { visibility },
      select: { id: true, visibility: true },
    });
  }

  async listByUser(userId: string, limit = 50): Promise<MissionListItem[]> {
    const rows = await this.prisma.agentPlaygroundMission.findMany({
      where: { userId },
      orderBy: { startedAt: "desc" },
      take: Math.min(Math.max(limit, 1), 200),
      select: {
        id: true,
        topic: true,
        depth: true,
        language: true,
        status: true,
        startedAt: true,
        completedAt: true,
        elapsedWallTimeMs: true,
        finalScore: true,
        tokensUsed: true,
        costUsd: true,
        reportTitle: true,
        reportSummary: true,
        errorMessage: true,
        visibility: true,
      },
    });
    return rows.map((r) => ({
      ...r,
      tokensUsed: r.tokensUsed != null ? Number(r.tokensUsed) : null,
    }));
  }

  async listByMissionIds(
    userId: string,
    missionIds: ReadonlyArray<string>,
  ): Promise<MissionListItem[]> {
    if (missionIds.length === 0) return [];
    const rows = await this.prisma.agentPlaygroundMission.findMany({
      where: { userId, id: { in: missionIds as string[] } },
      select: {
        id: true,
        topic: true,
        depth: true,
        language: true,
        status: true,
        startedAt: true,
        completedAt: true,
        elapsedWallTimeMs: true,
        finalScore: true,
        tokensUsed: true,
        costUsd: true,
        reportTitle: true,
        reportSummary: true,
        errorMessage: true,
        visibility: true,
      },
    });
    const mapped = rows.map((r) => ({
      ...r,
      tokensUsed: r.tokensUsed != null ? Number(r.tokensUsed) : null,
    }));
    const map = new Map(mapped.map((r) => [r.id, r]));
    return missionIds
      .map((id) => map.get(id))
      .filter((r): r is MissionListItem => !!r);
  }

  /**
   * 轻量存在性 + status 查询（同-id 续跑/重跑用）。createMissionRow 据此判断
   * 该"新建行"还是"原地 markReopened 续跑"——避免重跑/重启续跑撞 P2002 而被迫新建 id。
   */
  async getStatusById(id: string): Promise<{ status: string } | null> {
    return this.prisma.agentPlaygroundMission.findUnique({
      where: { id },
      select: { status: true },
    });
  }

  async getById(id: string, userId: string): Promise<MissionDetail | null> {
    const row = await this.prisma.agentPlaygroundMission.findFirst({
      where: { id, userId },
    });
    if (!row) return null;
    return {
      id: row.id,
      topic: row.topic,
      depth: row.depth,
      language: row.language,
      status: row.status,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      elapsedWallTimeMs: row.elapsedWallTimeMs,
      finalScore: row.finalScore,
      tokensUsed: row.tokensUsed != null ? Number(row.tokensUsed) : null,
      costUsd: row.costUsd,
      reportTitle: row.reportTitle,
      reportSummary: row.reportSummary,
      errorMessage: row.errorMessage,
      terminalOutcome: outcomeFromStatus(row.status),
      failureCode: row.failureCode ?? null,
      configSnapshot: row.configSnapshot ?? null,
      maxCredits: row.maxCredits,
      themeSummary: row.themeSummary,
      dimensions: row.dimensions,
      reportFull: row.reportFull,
      verdicts: row.verdicts,
      trajectoryStored: row.trajectoryStored,
      reportArtifactVersion: row.reportArtifactVersion,
      // ★ S4b:userProfile 是 configSnapshot 的读时投影(单一真源,不再独立存)。
      userProfile: projectUserProfileView(row.configSnapshot),
      reconciliationReport: row.reconciliationReport,
      leaderJournal: row.leaderJournal,
      leaderOverallScore: row.leaderOverallScore,
      leaderSigned: row.leaderSigned,
      leaderVerdict: row.leaderVerdict,
      lastCompletedStage: row.lastCompletedStage,
      outlinePlan: row.outlinePlan,
      analystOutput: row.analystOutput,
      heartbeatAt: row.heartbeatAt,
      visibility: row.visibility,
    };
  }

  /**
   * 仅取 mission 的 notify 元信息（userId + topic），按 id 查（无需 userId）。
   * 用于 liveness 回收路径发 MISSION_FAILED 通知 —— 那里只有 missionId，
   * mission:failed 事件的 userId 是空串，需从 DB 反查真实 owner。
   */
  async getMetaForNotify(
    missionId: string,
  ): Promise<{ userId: string; topic: string } | null> {
    const row = await this.prisma.agentPlaygroundMission.findUnique({
      where: { id: missionId },
      select: { userId: true, topic: true },
    });
    return row ? { userId: row.userId, topic: row.topic } : null;
  }

  /**
   * ★ P-IDOR2：按 id 查 mission 的读访问元信息（owner + visibility），**不**带
   * userId 过滤。供 `BaseMissionController.assertReadAccess` 判定 own ∨ PUBLIC ∨
   * SHARED+TopicMember —— `getById(id, userId)` 按 (id, userId) 过滤，非所有者
   * 永远 miss，无法支撑 PUBLIC/SHARED 放行，故需本方法暴露真实 owner/visibility。
   *
   * AgentPlaygroundMission 多租户走 workspaceId，无 topicId，故 topicId 恒为 null
   * （SHARED+TopicMember 在 mission 落地 topicId 前不放行，不杜撰）。查不到 → null。
   */
  async getAccessMetaById(missionId: string): Promise<{
    userId: string;
    visibility: ContentVisibility;
    topicId: string | null;
  } | null> {
    const row = await this.prisma.agentPlaygroundMission.findUnique({
      where: { id: missionId },
      select: { userId: true, visibility: true },
    });
    return row
      ? { userId: row.userId, visibility: row.visibility, topicId: null }
      : null;
  }
}
