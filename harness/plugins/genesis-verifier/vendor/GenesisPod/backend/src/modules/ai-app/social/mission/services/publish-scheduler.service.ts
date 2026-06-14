import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { SocialPipelineDispatcher } from "../pipeline/social-pipeline-dispatcher.service";
import { SocialContentStatus } from "../types";

/**
 * 定时发布调度器
 * 每分钟检查 scheduledAt 到期的内容并触发发布
 *
 * 2026-05-17 PR-2 单轨化：从 publishExecutor.execute（旧 sync 同步链式）切换到
 * SocialPipelineDispatcher.runMission（W4 Agent Team / fast-track pipeline）。
 * scheduled content 走 depth=quick，省 ~90% LLM cost、~70% 时延，保留 Steward
 * 预算闸 + s9 publish-verify。
 */
@Injectable()
export class PublishSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PublishSchedulerService.name);
  private isRunning = false;
  private intervalId: NodeJS.Timeout | null = null;

  // 检查间隔：1 分钟
  private readonly CHECK_INTERVAL_MS = 60 * 1000;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly dispatcher: SocialPipelineDispatcher,
  ) {}

  onModuleInit() {
    // ★ 2026-05-25 默认关闭:后台定时发布会跑 LLM + 真实平台发帖(外部副作用),
    //   必须显式 opt-in,绝不默认开。默认值 true → false。
    const enabled = this.configService.get<boolean>(
      "PUBLISH_SCHEDULER_ENABLED",
      false,
    );

    if (enabled) {
      this.logger.log("Publish scheduler initialized");
      this.startScheduler();
    } else {
      this.logger.log(
        "Publish scheduler is disabled. Set PUBLISH_SCHEDULER_ENABLED=true to enable.",
      );
    }
  }

  onModuleDestroy() {
    this.stopScheduler();
  }

  private startScheduler() {
    // 延迟 30 秒后首次检查，避免启动时立即执行
    setTimeout(() => {
      void this.processDuePublishes();
    }, 30_000).unref();

    this.intervalId = setInterval(() => {
      void this.processDuePublishes();
    }, this.CHECK_INTERVAL_MS).unref();

    this.logger.log(
      "Scheduler started: first check in 30s, then every 1 minute",
    );
  }

  private stopScheduler() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.logger.log("Scheduler stopped");
    }
  }

  /**
   * 处理到期的定时发布内容
   */
  async processDuePublishes(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    try {
      const now = new Date();

      // 查找所有到期的 SCHEDULED 内容
      // PR-2: 需要 userId + connectionId + connection.platformType 装配 dispatcher input
      const dueContents = await this.prisma.socialContent.findMany({
        where: {
          status: SocialContentStatus.SCHEDULED,
          scheduledAt: { lte: now },
          connectionId: { not: null },
        },
        select: {
          id: true,
          title: true,
          scheduledAt: true,
          userId: true,
          connectionId: true,
          connection: {
            select: {
              id: true,
              platformType: true,
            },
          },
        },
        take: 10, // 每次最多处理 10 条，防止单次批量过大
        orderBy: { scheduledAt: "asc" },
      });

      if (dueContents.length === 0) {
        return;
      }

      this.logger.log(
        `Found ${dueContents.length} scheduled content(s) due for publishing`,
      );

      for (const content of dueContents) {
        try {
          // 更新状态为 PENDING，防止重复处理
          const updated = await this.prisma.socialContent.updateMany({
            where: {
              id: content.id,
              status: SocialContentStatus.SCHEDULED, // CAS: 只有仍是 SCHEDULED 才更新
            },
            data: {
              status: SocialContentStatus.PENDING,
              updatedAt: new Date(),
            },
          });

          // 如果没有更新到任何行（被其他进程抢先处理），跳过
          if (updated.count === 0) {
            this.logger.debug(
              `Content ${content.id} already picked up, skipping`,
            );
            continue;
          }

          this.logger.log(
            `Triggering scheduled publish for: ${content.title} (id: ${content.id})`,
          );

          // PR-2 单轨化：走 dispatcher.runMission (depth=quick = 4-stage fast pipeline)
          // 装配 RunSocialMissionInput：从 content.connection 拿 platformType
          if (!content.connection) {
            // CAS 已守 connectionId not null，理论不可达；防御性 log + skip
            this.logger.warn(
              `Content ${content.id} has connectionId but connection record missing, skipping`,
            );
            continue;
          }
          const platformType = content.connection.platformType;
          const { missionId } = this.dispatcher.tryReserveInFlight(
            content.userId,
            content.id,
            [platformType],
          );

          // Fire-and-forget 执行 mission（depth=quick 走 fast pipeline）
          void this.dispatcher
            .runMission(
              missionId,
              {
                contentId: content.id,
                platforms: [platformType],
                connectionIds: { [platformType]: content.connection.id },
                depth: "quick",
                budgetProfile: "lean",
                language: "zh-CN",
              },
              content.userId,
            )
            .catch((err: unknown) => {
              const message = err instanceof Error ? err.message : String(err);
              this.logger.error(
                `Scheduled publish mission failed for ${content.id} (missionId=${missionId}): ${message}`,
              );
            });
        } catch (error) {
          this.logger.error(
            `Failed to process scheduled content ${content.id}: ${(error as Error).message}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(`Publish scheduler error: ${(error as Error).message}`);
    } finally {
      this.isRunning = false;
    }
  }
}
