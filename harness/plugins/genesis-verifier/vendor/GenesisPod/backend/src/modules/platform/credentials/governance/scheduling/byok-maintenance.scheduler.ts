import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { KeyAssignmentStatus } from "@prisma/client";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { KeyAssignmentsService } from "../key-assignments/key-assignments.service";

/**
 * BYOK 自动维护：标过期分配、关联模型 disabled 时联动 STALE、RECURRING 续期。
 *
 * 2026-05-08 v5（drop_distributable_keys）:
 *   - 删除 resetMonthlyQuotas（池级配额已废弃，spend 走 userSpendCents + CreditsService）
 *   - markStaleAssignments：触发条件由 DistributableKey.isActive=false 改为
 *     AIModel.isEnabled=false（管理员在 /admin/ai/models 关闭某模型时联动）
 *
 * 设计原则（防呆）：
 * - 任务幂等：过期只动 ACTIVE+已过期的分配；STALE 只动关联 disabled 模型的 ACTIVE
 * - 失败自恢复：单次失败不阻塞下一个周期；catch 包裹避免 Nest 进程崩溃
 * - 与管理员手动端点并存：保留 service 共用，不会产生二次状态
 */
@Injectable()
export class ByokMaintenanceScheduler {
  private readonly logger = new Logger(ByokMaintenanceScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly keyAssignments: KeyAssignmentsService,
  ) {}

  /**
   * 每天 UTC 00:20 把过期的 ACTIVE 分配标为 EXPIRED。
   * resolveActive 调用时也会懒标记，但定时批处理让 Admin UI 的统计更准。
   */
  @Cron("20 0 * * *", {
    name: "byok.expire-assignments",
    timeZone: "UTC",
  })
  async expireAssignments(): Promise<void> {
    try {
      // 限定 validityType='ONE_TIME'，避免误改 RECURRING 周期续期
      const result = await this.prisma.keyAssignment.updateMany({
        where: {
          status: KeyAssignmentStatus.ACTIVE,
          validityType: "ONE_TIME",
          expiresAt: { lt: new Date() },
        },
        data: { status: KeyAssignmentStatus.EXPIRED },
      });
      if (result.count > 0) {
        this.logger.log(
          `[cron:expire-assignments] Marked ${result.count} ONE_TIME assignments as EXPIRED`,
        );
      }
    } catch (error) {
      this.logger.error(
        `[cron:expire-assignments] Failed: ${(error as Error).message}`,
      );
    }
  }

  /**
   * 每小时检查关联 AIModel 已 disabled 的 ACTIVE 分配 → STALE
   *
   * 触发场景：管理员在 /admin/ai/models 把某模型 isEnabled=false
   * → 该模型下所有 ACTIVE KeyAssignment 同步 STALE
   * → admin UI 警告 + 前端用户引导重新申请其他模型
   *
   * cascade 不撤销 assignment（admin 可能重启 model），仅打标。
   * 反向 STALE→ACTIVE 不在 cron 里做：恢复路径已在 admin updateAIModel 路径
   * (isEnabled false→true) 通过 keyAssignmentsService.reactivateStale 显式触发
   * （PR-6 2026-05-12 落地）。这里只单向标 STALE。
   */
  @Cron(CronExpression.EVERY_HOUR, {
    name: "byok.mark-stale-assignments",
    timeZone: "UTC",
  })
  async markStaleAssignments(): Promise<void> {
    try {
      const result = await this.prisma.$executeRaw`
        UPDATE key_assignments
        SET status = 'STALE'
        WHERE status = 'ACTIVE'
          AND model_db_id IN (
            SELECT id FROM ai_models WHERE is_enabled = false
          )
      `;
      if (result > 0) {
        this.logger.warn(
          `[cron:mark-stale] Marked ${result} assignments as STALE (associated model disabled)`,
        );
      }
    } catch (error) {
      this.logger.error(
        `[cron:mark-stale] Failed: ${(error as Error).message}`,
      );
    }
  }

  /**
   * 每天 UTC 00:30 RECURRING 周期续期
   *
   * 订阅式周期：到 nextRenewalAt 时 reset userSpendCents=0 + 推下次续期时间。
   * status 不变（保持 ACTIVE），用户体感"额度自动重置"。
   */
  @Cron("30 0 * * *", {
    name: "byok.renew-recurring",
    timeZone: "UTC",
  })
  async renewRecurringAssignments(): Promise<void> {
    try {
      const now = new Date();
      const due = await this.prisma.keyAssignment.findMany({
        where: {
          status: KeyAssignmentStatus.ACTIVE,
          validityType: "RECURRING",
          nextRenewalAt: { lte: now },
        },
        select: {
          id: true,
          recurrenceUnit: true,
          recurrenceInterval: true,
          nextRenewalAt: true,
        },
      });
      let succeeded = 0;
      for (const a of due) {
        if (!a.recurrenceUnit || !a.recurrenceInterval || !a.nextRenewalAt) {
          this.logger.warn(
            `[cron:renew] Assignment ${a.id} RECURRING but missing fields, skip`,
          );
          continue;
        }
        // 复用 service.computeNextRenewalAt（含跨月 clamp，feedback_no_dual_sources）
        const next = this.keyAssignments.computeNextRenewalAt(
          a.nextRenewalAt,
          a.recurrenceUnit as "WEEK" | "MONTH" | "YEAR",
          a.recurrenceInterval,
        );
        try {
          await this.prisma.keyAssignment.update({
            where: { id: a.id },
            data: {
              userSpendCents: 0,
              nextRenewalAt: next,
            },
          });
          succeeded++;
        } catch (err) {
          this.logger.warn(
            `[cron:renew] Failed renew ${a.id}: ${(err as Error).message}`,
          );
        }
      }
      if (succeeded > 0) {
        this.logger.log(
          `[cron:renew-recurring] Renewed ${succeeded}/${due.length} recurring assignments`,
        );
      }
    } catch (error) {
      this.logger.error(
        `[cron:renew-recurring] Failed: ${(error as Error).message}`,
      );
    }
  }

  /** 每小时 5 分：健康自检，让 Railway 日志能看到调度器活着 */
  @Cron(CronExpression.EVERY_HOUR, { name: "byok.heartbeat" })
  async heartbeat(): Promise<void> {
    this.logger.debug("[cron:heartbeat] BYOK scheduler alive");
  }
}
