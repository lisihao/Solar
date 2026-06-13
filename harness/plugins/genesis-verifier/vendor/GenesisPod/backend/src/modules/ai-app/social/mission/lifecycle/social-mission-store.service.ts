/**
 * SocialMissionStore — SocialPublishMission lifecycle 持久化（Prisma 真实现）
 *
 * 2026-05-16 round-2-followup：从 in-memory map 升级到 Prisma social_missions
 * 表持久化。Reviewer A P1-A3 持票项已闭环 —— pod restart 不再丢 mission，
 * trajectory 可查、retry/cascade rerun 有数据基础。
 *
 * 与 AgentPlaygroundMission store 形态一致；差异：
 *   - 无 leaderJournal / reportArtifact / dimensions / verdicts 等 research 业务字段
 *   - 多 contentId / platforms / connectionIds 等社交业务字段
 *   - trajectory JSON 字段在 S11 阶段统一写一次（无增量 partial 写）
 */

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import type { Prisma } from "@prisma/client";
import {
  MissionFailureCode,
  type MissionTerminalArbiter,
  type MissionTerminalIntent,
} from "@/modules/ai-harness/facade";
import type { SocialConfigSnapshot } from "./social-mission-config-snapshot";

export interface CreateSocialMissionArgs {
  id: string;
  userId: string;
  workspaceId?: string;
  contentId: string;
  platforms: readonly string[];
  connectionIds: Readonly<Record<string, string>>;
  depth: string;
  budgetProfile: string;
  language: string;
  maxCredits: number;
  /** ★ C5/G7（三 app 统一）：typed MissionConfigSnapshot(canonical 配置记录)。 */
  configSnapshot?: SocialConfigSnapshot;
}

export interface MarkCompletedDetail {
  tokensUsed?: number;
  costUsd?: number;
  /** ★ C4/G5：实测耗时(原 wallTimeMs,与配置上限二义→改名)。 */
  elapsedWallTimeMs?: number;
  trajectory?: Prisma.InputJsonValue;
}

export interface MarkFailedDetail {
  errorMessage: string;
  tokensUsed?: number;
  costUsd?: number;
  /** ★ C4/G5：实测耗时(原 wallTimeMs)。 */
  elapsedWallTimeMs?: number;
  /** ★ C2/G3：canonical MissionFailureCode（L1 类型,禁裸字符串）。落 DB failure_code 列。 */
  failureCode?: MissionFailureCode;
}

/**
 * ★ C0/G1：social 终态 arbiter 富载荷（判别式）。dispatcher 完成/取消/失败、liveness 回收
 * 经 MissionLifecycleManager.finalize 提交 intent，arbiter 据 kind 落终态。social 仅平台
 * 3 终态（无 radar 的 rejected 业务态）；liveness 回收用 failed kind（detail 无 metrics）。
 */
export type SocialTerminalExtra =
  | { readonly kind: "completed"; readonly detail?: MarkCompletedDetail }
  | { readonly kind: "failed"; readonly detail: MarkFailedDetail }
  | { readonly kind: "cancelled"; readonly reason?: string };

@Injectable()
export class SocialMissionStore implements MissionTerminalArbiter<SocialTerminalExtra> {
  private readonly log = new Logger(SocialMissionStore.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * ★ C0/G1：唯一终态写仲裁口。所有终态来源（dispatcher 完成/取消/失败、liveness 回收）
   * 经 MissionLifecycleManager.finalize 提交 intent，由此单点条件写（WHERE status='running'）
   * 首写者赢。返回 true=本次赢、false=已终态 no-op。
   */
  async applyTerminalIfRunning(
    missionId: string,
    intent: MissionTerminalIntent<SocialTerminalExtra>,
  ): Promise<boolean> {
    const extra = intent.extra;
    if (!extra) return false; // 防御：social 终态必须带 extra（理论不可达）
    switch (extra.kind) {
      case "completed":
        return this.writeCompleted(missionId, extra.detail);
      case "failed":
        return this.writeFailed(missionId, extra.detail);
      case "cancelled":
        return this.writeCancelled(missionId, extra.reason);
    }
  }

  async create(args: CreateSocialMissionArgs): Promise<void> {
    const podId =
      process.env.RAILWAY_REPLICA_ID ?? process.env.HOSTNAME ?? "local";
    await this.prisma.socialMission.create({
      data: {
        id: args.id,
        userId: args.userId,
        workspaceId: args.workspaceId,
        contentId: args.contentId,
        platforms: [...args.platforms],
        connectionIds: args.connectionIds as Prisma.InputJsonValue,
        depth: args.depth,
        budgetProfile: args.budgetProfile,
        language: args.language,
        maxCredits: args.maxCredits,
        status: "running",
        podId,
        heartbeatAt: new Date(),
        configSnapshot: args.configSnapshot as
          | Prisma.InputJsonValue
          | undefined,
      },
    });
    this.log.log(
      `[create] mission=${args.id} user=${args.userId} platforms=${args.platforms.join(",")} maxCredits=${args.maxCredits}`,
    );
  }

  async refreshHeartbeat(missionId: string, podId: string): Promise<void> {
    await this.prisma.socialMission
      .update({
        where: { id: missionId },
        data: { heartbeatAt: new Date(), podId },
      })
      .catch((err: unknown) => {
        // mission 可能已被清理 / orphan-cleanup 标 failed —— heartbeat 非致命
        this.log.warn(
          `[refreshHeartbeat] mission=${missionId} failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }

  // ★ C0/G1：以下 3 个 writeX 是 arbiter 私有落库实现，仅 applyTerminalIfRunning 调用。
  //   外部一律经 finalize → applyTerminalIfRunning，禁止直写终态（conformance 看护）。
  //   均为条件写 WHERE status='running'（首写赢），返回 count>0=本次赢。
  private async writeCompleted(
    missionId: string,
    detail?: MarkCompletedDetail,
  ): Promise<boolean> {
    const res = await this.prisma.socialMission
      .updateMany({
        where: { id: missionId, status: "running" },
        data: {
          status: "completed",
          completedAt: new Date(),
          tokensUsed:
            detail?.tokensUsed != null ? BigInt(detail.tokensUsed) : null,
          costUsd: detail?.costUsd ?? null,
          elapsedWallTimeMs: detail?.elapsedWallTimeMs ?? null,
          trajectory: detail?.trajectory,
        },
      })
      .catch((err: unknown) => {
        this.log.warn(
          `[writeCompleted] mission=${missionId} failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
        );
        return { count: 0 };
      });
    return res.count > 0;
  }

  private async writeFailed(
    missionId: string,
    detail: MarkFailedDetail,
  ): Promise<boolean> {
    const res = await this.prisma.socialMission
      .updateMany({
        where: { id: missionId, status: "running" },
        data: {
          status: "failed",
          completedAt: new Date(),
          errorMessage: detail.errorMessage.slice(0, 4000),
          failureCode: detail.failureCode ?? null,
          tokensUsed:
            detail.tokensUsed != null ? BigInt(detail.tokensUsed) : null,
          costUsd: detail.costUsd ?? null,
          elapsedWallTimeMs: detail.elapsedWallTimeMs ?? null,
        },
      })
      .catch((err: unknown) => {
        this.log.warn(
          `[writeFailed] mission=${missionId} failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
        );
        return { count: 0 };
      });
    return res.count > 0;
  }

  /**
   * 用户取消落终态。★ 评审 code-MAJOR-1:此前 social 无 cancelled 路径,取消走 failed →
   * 前端 outcomeFromStatus 投影成 failure(显示"失败"非"已取消")。本路径落 status=cancelled
   * + failureCode=user_cancelled,outcomeFromStatus → cancelled。
   */
  private async writeCancelled(
    missionId: string,
    reason?: string,
  ): Promise<boolean> {
    const res = await this.prisma.socialMission
      .updateMany({
        where: { id: missionId, status: "running" },
        data: {
          status: "cancelled",
          completedAt: new Date(),
          errorMessage: reason?.slice(0, 4000) ?? null,
          failureCode: MissionFailureCode.user_cancelled,
        },
      })
      .catch((err: unknown) => {
        this.log.warn(
          `[writeCancelled] mission=${missionId} failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
        );
        return { count: 0 };
      });
    return res.count > 0;
  }

  /**
   * Liveness 扫描用：列出所有 running mission 的存活字段。
   * 供 AiSocialModule onModuleInit 注册的 MissionLivenessGuard adapter 调用——
   * ★ 2026-05-22 C8：social_missions 早有 heartbeatAt/podId + [status,heartbeatAt] 索引，
   *   但此前从未注册 liveness adapter，孤儿 running 行永不回收。本方法 + 注册补上扫描链。
   */
  async fetchRunningForLiveness(): Promise<
    Array<{
      id: string;
      userId: string;
      startedAt: Date;
      heartbeatAt: Date | null;
    }>
  > {
    return this.prisma.socialMission.findMany({
      where: { status: "running" },
      select: { id: true, userId: true, startedAt: true, heartbeatAt: true },
      take: 200,
    });
  }

  // ★ C0/G1：原 markFailedByLiveness 已折叠进 arbiter 的 failed kind——liveness 回收
  //   经 finalize → applyTerminalIfRunning({extra:{kind:'failed',detail:{errorMessage,failureCode}}})。

  /** 写 S11 trajectory；与终态写解耦，让 S11 失败也能保留 partial trajectory */
  async saveTrajectory(
    missionId: string,
    trajectory: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.prisma.socialMission
      .update({
        where: { id: missionId },
        data: { trajectory },
      })
      .catch((err: unknown) => {
        this.log.warn(
          `[saveTrajectory] mission=${missionId} failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }

  /** Gateway join 时核对 ownership */
  async getOwner(missionId: string): Promise<string | undefined> {
    const row = await this.prisma.socialMission
      .findUnique({
        where: { id: missionId },
        select: { userId: true },
      })
      .catch(() => null);
    return row?.userId;
  }

  /** controller / detail 页查 mission 元信息 */
  async getById(missionId: string, userId: string) {
    return this.prisma.socialMission.findFirst({
      where: { id: missionId, userId },
    });
  }

  /**
   * 记录 SocialPublishLog —— admin 历史日志 / 审计 / 排错入口
   *
   * 2026-05-17 PR-6：W4 mission pipeline 接管发布后，老 publish-executor
   * .execute() 路径里的 socialPublishLog.create 被绕过；S8 stage 必须显式补写
   * 才能让 admin 在内容详情 / 后台日志页继续看到逐平台真发结果。
   *
   * 写日志失败仅 warn（业务不阻断 —— 发布动作的真实成败靠 socialContent.status
   * + mission trajectory 兜底）。
   */
  async recordPublishLog(args: {
    contentId: string;
    action: "PUBLISH" | "SCHEDULE" | "CANCEL" | "RETRY";
    status: "SUCCESS" | "FAILED" | "PENDING";
    details?: Prisma.InputJsonValue;
    errorMessage?: string;
  }): Promise<void> {
    await this.prisma.socialPublishLog
      .create({
        data: {
          contentId: args.contentId,
          action: args.action,
          status: args.status,
          details: args.details,
          errorMessage: args.errorMessage?.slice(0, 4000),
        },
      })
      .catch((err: unknown) => {
        this.log.warn(
          `[recordPublishLog] content=${args.contentId} action=${args.action} status=${args.status} failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }
}
