import { Injectable, Logger, Optional } from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import {
  EventBus,
  MissionCheckpointService,
} from "@/modules/ai-harness/facade";
import { MissionRerunOrchestratorService } from "./mission-rerun-orchestrator.service";

export const AUTO_RECOVERED_EVENT = "playground.mission:auto-recovered";

/**
 * MissionAutoRecoveryService —— liveness 停滞击杀后的自动恢复（2026-06-12）。
 *
 * 背景：boot 孤儿路径已有自动续跑（pipeline.maybeResumeOrphan，P-DUR2 原子认领），
 * 但 **LivenessGuard 运行期停滞击杀**（无心跳 + 无事件 ≥ 15min → markFailed）此前
 * 只杀不恢复 —— 用户实证"后台复位后任务失联，只能手动重跑"命中的正是这条路径。
 *
 * 护栏（防 retry storm，对齐 CLAUDE.md 反向洞察 #4/#5 教训）：
 *   1. wall-time 击杀不恢复 —— 预算耗尽的 mission 复活只会继续烧（调用方过滤 reason）
 *   2. 终生最多 1 次自动恢复 —— journal 计数 auto-recovered 事件；恢复后再次停滞
 *      即终态，杜绝"复活→停滞→复活"循环。计数查询失败按已达上限处理（fail-closed）
 *   3. canResume 门 —— checkpoint 存在 + 24h 窗内 + 非真终态（与 boot 路径同款）
 *   4. PLAYGROUND_AUTO_RECOVERY=false 可整体关闭（默认开，与 boot 路径行为一致）
 *
 * 恢复 = rerunFullMission(missionId, userId, "incremental")：同 id 原地续跑
 * （markReopened 发 mission:reopened，跳过已完成 stage），与手动「继续上次」同一条路。
 */
@Injectable()
export class MissionAutoRecoveryService {
  private readonly log = new Logger(MissionAutoRecoveryService.name);
  static readonly MAX_AUTO_RECOVERIES = 1;

  constructor(
    private readonly prisma: PrismaService,
    private readonly missionCheckpoint: MissionCheckpointService,
    private readonly eventBus: EventBus,
    @Optional()
    private readonly rerunOrchestrator?: MissionRerunOrchestratorService,
  ) {}

  /**
   * 在 liveness 停滞击杀 finalize 胜者回调后调用（fire-and-forget）。
   * 返回 true = 已触发原地续跑（mission 将转回 running 并发 mission:reopened）。
   */
  async attemptAfterStaleKill(
    missionId: string,
    userId: string,
  ): Promise<boolean> {
    if (process.env.PLAYGROUND_AUTO_RECOVERY === "false") {
      this.log.log(
        `auto_recovery_disabled missionId=${missionId} (PLAYGROUND_AUTO_RECOVERY=false)`,
      );
      return false;
    }
    if (!this.rerunOrchestrator) {
      this.log.warn(
        `auto_recovery_skipped missionId=${missionId} reason=orchestrator-absent`,
      );
      return false;
    }

    /* 护栏 2：终生 1 次。计数失败按已达上限处理（宁可不恢复，不可循环烧钱） */
    const prior = await this.prisma.agentPlaygroundMissionEvent
      .count({ where: { missionId, type: AUTO_RECOVERED_EVENT } })
      .catch((err: unknown) => {
        this.log.warn(
          `auto_recovery_count_failed missionId=${missionId} (fail-closed): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return Number.MAX_SAFE_INTEGER;
      });
    if (prior >= MissionAutoRecoveryService.MAX_AUTO_RECOVERIES) {
      this.log.warn(
        `auto_recovery_cap_reached missionId=${missionId} prior=${prior} ` +
          `max=${MissionAutoRecoveryService.MAX_AUTO_RECOVERIES} action=stay-failed`,
      );
      return false;
    }

    /* 护栏 3：canResume 门（checkpoint 存在 + 窗内 + 非真终态） */
    const decision = await this.missionCheckpoint
      .canResume(missionId)
      .catch(() => null);
    if (!decision?.canResume) {
      this.log.warn(
        `auto_recovery_not_resumable missionId=${missionId} ` +
          `reason=${decision?.reason ?? "canResume-threw"} action=stay-failed`,
      );
      return false;
    }

    try {
      await this.rerunOrchestrator.rerunFullMission(
        missionId,
        userId,
        "incremental",
      );
      /* 审计事件 —— 同时是护栏 2 的计数来源（落 journal 表） */
      await this.eventBus
        .emit({
          type: AUTO_RECOVERED_EVENT,
          scope: { missionId, userId },
          payload: { trigger: "liveness-stale", attempt: prior + 1 },
          timestamp: Date.now(),
        })
        .catch((err: unknown) => {
          this.log.warn(
            `auto_recovery_audit_emit_failed missionId=${missionId}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        });
      this.log.warn(
        `auto_recovered_in_place missionId=${missionId} mode=incremental ` +
          `trigger=liveness-stale attempt=${prior + 1}`,
      );
      return true;
    } catch (err) {
      this.log.warn(
        `auto_recovery_failed missionId=${missionId} ` +
          `reason="${err instanceof Error ? err.message : String(err)}" action=stay-failed`,
      );
      return false;
    }
  }
}
