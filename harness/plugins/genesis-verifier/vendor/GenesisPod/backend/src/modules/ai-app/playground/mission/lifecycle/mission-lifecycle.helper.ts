/**
 * MissionLifecycleHelper — mission 终态转换
 *
 * ★ 2026-05-24 P6 Wave 1：framework 化下沉到
 *   `ai-harness/teams/business-team/lifecycle/business-team-lifecycle-transitions.framework.ts`。
 *   本文件仅注入 playground 专属：业务字段映射 (writeCompleted / writeFailed update shape) +
 *   Prisma agentPlaygroundMission delegate。
 *
 * ★ C0/G1：writeCompleted / writeCancelled / writeFailed 是 arbiter 私有落库实现，
 *   仅 MissionStore.applyTerminalIfRunning 调用。
 */

import { Logger } from "@nestjs/common";
import { MissionFailureCode } from "@/modules/ai-harness/facade";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import {
  BusinessTeamLifecycleTransitionsFramework,
  type LifecycleTransitionHooks,
} from "@/modules/ai-harness/facade";

export interface PlaygroundCompletedDetail {
  finalScore?: number;
  tokensUsed?: number;
  costUsd?: number;
  trajectoryStored?: number;
  elapsedWallTimeMs?: number;
  themeSummary?: string;
  dimensions?: unknown;
  report?: { title?: string; summary?: string; [k: string]: unknown };
  verdicts?: unknown;
  reportArtifactVersion?: number;
  reconciliationReport?: unknown;
  leaderJournal?: unknown;
  leaderOverallScore?: number;
  leaderSigned?: boolean;
  leaderVerdict?: string;
}

export interface PlaygroundFailedDetail {
  errorMessage?: string;
  failureCode?: MissionFailureCode;
  tokensUsed?: number;
  costUsd?: number;
  elapsedWallTimeMs?: number;
  trajectoryStored?: number;
  themeSummary?: string;
  dimensions?: unknown;
  report?: { title?: string; summary?: string; [k: string]: unknown };
  verdicts?: unknown;
  reportArtifactVersion?: number;
  reconciliationReport?: unknown;
  leaderJournal?: unknown;
  leaderOverallScore?: number;
  leaderSigned?: boolean;
  leaderVerdict?: string;
}

export class MissionLifecycleHelper extends BusinessTeamLifecycleTransitionsFramework<
  PlaygroundCompletedDetail,
  PlaygroundFailedDetail
> {
  // Note: legacy private logger kept for back-compat warn channels (e.g. appendLeaderJournal).
  private readonly playgroundLog = new Logger(MissionLifecycleHelper.name);

  constructor(
    private readonly prisma: PrismaService,
    // isMissionRowMissing / emergencyAbortOnMissingRow reserved for future use
    _isMissionRowMissing: (err: unknown) => boolean,
    _emergencyAbortOnMissingRow: (missionId: string, reason: string) => void,
    clearCheckpointJsonbKey: (missionId: string) => Promise<void>,
  ) {
    const hooks: LifecycleTransitionHooks<
      PlaygroundCompletedDetail,
      PlaygroundFailedDetail
    > = {
      // ★ 2026-05-30：playground 允许从 cancelled 复活（默认只有 failed/quality-failed）。
      //   用户对一个被取消的 mission 点「重跑」= 明确想重新跑；不复活的话 cascade 会跑、
      //   烧额度，但终态永远卡在 cancelled，重跑的真实失败（如额度耗尽）写不回也显示不出来。
      reopenableStatuses: ["failed", "quality-failed", "cancelled"],
      buildCompletedUpdate: (d) => {
        const update: Prisma.AgentPlaygroundMissionUpdateInput = {
          status: "completed",
          completedAt: new Date(),
          finalScore: d.finalScore ?? null,
          tokensUsed: d.tokensUsed ?? null,
          costUsd: d.costUsd ?? null,
          trajectoryStored: d.trajectoryStored ?? null,
          elapsedWallTimeMs: d.elapsedWallTimeMs ?? null,
          themeSummary: d.themeSummary ?? null,
          dimensions: (d.dimensions ?? null) as Prisma.InputJsonValue,
          reportFull: (d.report ?? null) as Prisma.InputJsonValue,
          verdicts: (d.verdicts ?? null) as Prisma.InputJsonValue,
          reportTitle: d.report?.title?.slice(0, 500) ?? null,
          reportSummary: d.report?.summary ?? null,
          reportArtifactVersion: d.reportArtifactVersion ?? null,
          reconciliationReport: (d.reconciliationReport ??
            null) as Prisma.InputJsonValue,
          leaderJournal:
            d.leaderJournal !== undefined
              ? ((d.leaderJournal ?? null) as Prisma.InputJsonValue)
              : undefined,
          leaderOverallScore: d.leaderOverallScore ?? null,
          leaderSigned: d.leaderSigned ?? null,
          leaderVerdict: d.leaderVerdict ?? null,
        };
        return update as Record<string, unknown>;
      },
      buildFailedUpdate: (d) => {
        if (d.report && typeof d.report === "object") {
          const failSize = Buffer.byteLength(JSON.stringify(d.report), "utf8");
          if (failSize > 10 * 1024 * 1024) {
            d.errorMessage = "report_too_large";
            d.report = undefined;
          }
        }
        const isLeadRefusal = d.leaderSigned === false;
        const update: Prisma.AgentPlaygroundMissionUpdateInput = {
          status: isLeadRefusal ? "quality-failed" : "failed",
          completedAt: new Date(),
          errorMessage: d.errorMessage?.slice(0, 2000) ?? null,
          failureCode:
            d.failureCode ??
            (isLeadRefusal ? MissionFailureCode.leader_signoff_rejected : null),
          tokensUsed: d.tokensUsed ?? null,
          costUsd: d.costUsd ?? null,
          elapsedWallTimeMs: d.elapsedWallTimeMs ?? null,
        };
        if (d.trajectoryStored != null)
          update.trajectoryStored = d.trajectoryStored;
        if (d.themeSummary != null) update.themeSummary = d.themeSummary;
        if (d.dimensions !== undefined)
          update.dimensions = (d.dimensions ?? null) as Prisma.InputJsonValue;
        if (d.report !== undefined) {
          update.reportFull = (d.report ?? null) as Prisma.InputJsonValue;
          update.reportTitle = d.report?.title?.slice(0, 500) ?? null;
          update.reportSummary = d.report?.summary ?? null;
        }
        if (d.verdicts !== undefined)
          update.verdicts = (d.verdicts ?? null) as Prisma.InputJsonValue;
        if (d.reportArtifactVersion != null)
          update.reportArtifactVersion = d.reportArtifactVersion;
        if (d.reconciliationReport !== undefined)
          update.reconciliationReport = (d.reconciliationReport ??
            null) as Prisma.InputJsonValue;
        if (d.leaderOverallScore !== undefined)
          update.leaderOverallScore = d.leaderOverallScore ?? null;
        if (d.leaderSigned !== undefined)
          update.leaderSigned = d.leaderSigned ?? null;
        if (d.leaderVerdict !== undefined)
          update.leaderVerdict = d.leaderVerdict ?? null;
        if (d.leaderJournal !== undefined)
          update.leaderJournal = (d.leaderJournal ??
            null) as Prisma.InputJsonValue;
        return {
          update: update as Record<string, unknown>,
          isLeadRefusal,
          effectiveFailureCode:
            d.failureCode ??
            (isLeadRefusal ? MissionFailureCode.leader_signoff_rejected : null),
        };
      },
      buildCancelledUpdate: () => ({
        status: "cancelled",
        completedAt: new Date(),
        errorMessage: "Mission cancelled by user.",
      }),
      conditionalUpdate: async (missionId, where, data) => {
        const res = await prisma.agentPlaygroundMission.updateMany({
          where: {
            id: missionId,
            status: "running",
            ...(where.userId ? { userId: where.userId } : {}),
          },
          data: data as Prisma.AgentPlaygroundMissionUpdateManyMutationInput,
        });
        return res.count;
      },
      clearCheckpoint: clearCheckpointJsonbKey,
      reopenTransaction: async (missionId, userId, allowedFromStatuses) => {
        return prisma.$transaction(async (tx) => {
          const updated = await tx.agentPlaygroundMission.updateMany({
            where: {
              id: missionId,
              userId,
              status: { in: [...allowedFromStatuses] },
            },
            data: {
              status: "running",
              // ★ 2026-06-11 同-id 续跑/重跑：bump 版本号（"无非增加一个版本"），
              //   不新建 mission 行。前端可显示"第 N 次运行"。
              runCount: { increment: 1 },
              errorMessage: null,
              completedAt: null,
              finalScore: null,
              leaderSigned: null,
              leaderOverallScore: null,
              leaderVerdict: null,
            },
          });
          if (updated.count === 0) {
            const probe = await tx.agentPlaygroundMission.findFirst({
              where: { id: missionId, userId },
              select: { status: true },
            });
            return {
              affected: 0,
              currentStatus: probe?.status ?? null,
            };
          }
          await tx.agentPlaygroundMissionEvent.create({
            data: {
              missionId,
              type: "playground.mission:reopened",
              payload: {
                triggeredBy: userId,
                ts: Date.now(),
              } as Prisma.InputJsonValue,
              ts: BigInt(Date.now()),
            },
          });
          return { affected: updated.count, currentStatus: "running" };
        });
      },
      reopenResetData: {},
    };
    super(hooks, "MissionLifecycleHelper");
  }

  /** Append patch to leaderJournal JSON column (playground-only). */
  async appendLeaderJournal(
    id: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.$transaction(
        async (tx) => {
          const row = await tx.agentPlaygroundMission.findUnique({
            where: { id },
            select: { leaderJournal: true, leaderJournalUri: true },
          });
          const current =
            (row?.leaderJournal as Record<string, unknown> | null) ?? {};
          const merged = { ...current, ...patch };
          if (
            Array.isArray(current.decisions) &&
            Array.isArray((patch as { decisions?: unknown[] }).decisions)
          ) {
            merged.decisions = [
              ...(current.decisions as unknown[]),
              ...((patch as { decisions: unknown[] }).decisions ?? []),
            ];
          }
          await tx.agentPlaygroundMission.update({
            where: { id },
            data: { leaderJournal: merged as Prisma.InputJsonValue },
          });
        },
        { isolationLevel: "Serializable" },
      );
    } catch (err) {
      this.playgroundLog.warn(
        `[appendLeaderJournal ${id}] failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
