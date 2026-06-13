import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  RefreshFrequency,
  ResearchMissionStatus,
  ResearchTopicStatus,
} from "@prisma/client";
import { TopicTeamOrchestratorService } from "../core/topic/topic-team-orchestrator.service";
// ★ P1-CTX-BYOK (2026-04-30): cron 触发的刷新链路必须显式注入 RequestContext.userId,
//   否则下游 AiChatService 走不到 BYOK key resolver — BYOK-only 用户全 fail。
import { withUserContext } from "../../../../../common/context";

/**
 * Topic Refresh Scheduler
 *
 * 负责管理专题的定时刷新：
 * 1. 每小时检查需要刷新的专题
 * 2. 根据刷新频率计算下次刷新时间
 * 3. 执行增量刷新
 */
@Injectable()
export class TopicRefreshScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TopicRefreshScheduler.name);
  private intervalHandle: NodeJS.Timeout | null = null;

  // 检查间隔：1小时
  private readonly CHECK_INTERVAL_MS = 60 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly orchestrator: TopicTeamOrchestratorService,
  ) {}

  async onModuleInit() {
    // ════════════════════════════════════════════════════════════════════════
    // ★ 2026-05-25「背后默默烧钱」总开关 —— 默认 OFF。
    //   定时刷新会在后台无人值守地反复触发全量研究报告(deepseek 等),BYOK 用户
    //   烧的是自己 provider 的真金白银,且平台 credit 闸对 BYOK 不生效。这种"静默
    //   后台消耗"必须显式 opt-in,绝不默认开。运维要启用须显式设
    //   ENABLE_TOPIC_AUTO_REFRESH=true。未开启则连定时器都不装,彻底不跑。
    // ════════════════════════════════════════════════════════════════════════
    if (process.env.ENABLE_TOPIC_AUTO_REFRESH !== "true") {
      this.logger.warn(
        "[TopicRefreshScheduler] DISABLED — background topic auto-refresh will NOT run. " +
          "Set ENABLE_TOPIC_AUTO_REFRESH=true to opt in. " +
          "（默认关闭:杜绝后台静默烧 token/BYOK 账单）",
      );
      return;
    }

    this.logger.log("Topic Refresh Scheduler initialized (opt-in ENABLED)");

    // 启动时更新所有专题的下次刷新时间
    // 使用 try-catch 优雅处理表不存在的情况（数据库迁移未完成）
    try {
      await this.updateNextRefreshTimes();
    } catch (error) {
      // P2021: 表不存在
      if (
        error instanceof Error &&
        "code" in error &&
        (error as { code: string }).code === "P2021"
      ) {
        this.logger.warn(
          "ResearchTopic table does not exist yet. Scheduler will retry on next interval.",
        );
      } else {
        this.logger.error("Failed to update next refresh times on init", error);
      }
    }

    // 设置定时检查
    this.intervalHandle = setInterval(() => {
      void this.checkAndRefreshTopics().catch((err) => {
        this.logger.error("Scheduled refresh check failed", err);
      });
    }, this.CHECK_INTERVAL_MS).unref();

    this.logger.log(
      `Scheduled refresh check every ${this.CHECK_INTERVAL_MS / 1000 / 60} minutes`,
    );
  }

  onModuleDestroy() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      this.logger.log("Topic Refresh Scheduler stopped");
    }
  }

  /**
   * 检查需要刷新的专题（每小时调用一次）
   */
  async checkAndRefreshTopics() {
    this.logger.debug("Checking for topics that need refresh...");

    try {
      // 查找需要刷新的专题
      // 如果表不存在会抛出 P2021 错误，在外层 catch 中处理
      const topicsToRefresh = await this.prisma.researchTopic.findMany({
        where: {
          status: ResearchTopicStatus.ACTIVE,
          refreshFrequency: { not: RefreshFrequency.MANUAL },
          nextRefreshAt: { lte: new Date() },
        },
        take: 5, // 每次最多处理5个专题，避免过载
        orderBy: { nextRefreshAt: "asc" },
      });

      if (topicsToRefresh.length === 0) {
        this.logger.debug("No topics need refresh");
        return;
      }

      this.logger.log(`Found ${topicsToRefresh.length} topics to refresh`);

      // 顺序处理每个专题
      for (const topic of topicsToRefresh) {
        try {
          await this.refreshTopic(topic.id);
        } catch (error) {
          this.logger.error(
            `Failed to refresh topic ${topic.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    } catch (error) {
      // P2021: 表不存在 - 优雅降级，等待数据库迁移
      if (
        error instanceof Error &&
        "code" in error &&
        (error as { code: string }).code === "P2021"
      ) {
        this.logger.debug(
          "ResearchTopic table does not exist yet. Skipping refresh check.",
        );
      } else {
        this.logger.error("Error in scheduled refresh check", error);
      }
    }
  }

  /**
   * 刷新单个专题
   */
  private async refreshTopic(topicId: string): Promise<void> {
    const topic = await this.prisma.researchTopic.findUnique({
      where: { id: topicId },
    });

    if (!topic) {
      this.logger.warn(`Topic ${topicId} not found for scheduled refresh`);
      return;
    }

    // ════════════════════════════════════════════════════════════════════════
    // ★ 2026-05-25 失控事故修复(必读) —— 防止"同一专题被每小时反复并发刷新"。
    //
    //   旧实现把 nextRefreshAt 只在 executeRefresh **完成后**才更新,且无任何并发
    //   保护。但一次刷新常耗时 >1h,远超本调度器 1h 的检查间隔 → 每个 tick 都把同一个
    //   还没跑完、nextRefreshAt 仍到期的专题再选出来、再起一个并发 executeRefresh。
    //   同名维度刷出 3-4 份、队列堆到 80、BYOK 用户的 provider 账单被无限叠加(平台
    //   credit 闸对 BYOK 不生效)。orchestrator 把旧 mission 标 FAILED 也救不了 ——
    //   in-flight 的 LLM 循环不读 DB 状态,照烧不误。唯一根治是**不让重叠刷新启动**。
    //
    //   两道闸:
    //     闸①  该专题已有进行中的 mission → 直接跳过,绝不并发再起一个。
    //     闸②  原子 claim:仅当"当前仍到期"才把 nextRefreshAt 先推到下一周期再跑。
    //          updateMany 在 DB 层原子,并发 tick / 多 pod 只有一个 count=1 抢到;
    //          执行前就推进,下一 tick 不会再选中本专题;失败也不立刻重试(无 retry
    //          storm),等下一周期。
    // ════════════════════════════════════════════════════════════════════════

    // 闸①：已有进行中的刷新 mission → 跳过
    const inFlight = await this.prisma.researchMission.findFirst({
      where: {
        topicId,
        status: {
          in: [
            ResearchMissionStatus.PLANNING,
            ResearchMissionStatus.PLAN_READY,
            ResearchMissionStatus.EXECUTING,
            ResearchMissionStatus.REVIEWING,
          ],
        },
      },
      select: { id: true },
    });
    if (inFlight) {
      this.logger.warn(
        `[refreshTopic] topic "${topic.name}" already has in-flight mission ${inFlight.id}; skip scheduled refresh (anti-runaway)`,
      );
      return;
    }

    // 闸②：原子 claim —— 执行前就把 nextRefreshAt 推到下一周期
    const nextRefreshAt = this.calculateNextRefreshTime(topic.refreshFrequency);
    const claim = await this.prisma.researchTopic.updateMany({
      where: { id: topicId, nextRefreshAt: { lte: new Date() } },
      data: { nextRefreshAt, lastRefreshAt: new Date() },
    });
    if (claim.count === 0) {
      this.logger.debug(
        `[refreshTopic] topic ${topicId} already claimed by another tick/pod; skip`,
      );
      return;
    }

    this.logger.log(
      `Starting scheduled refresh for topic: ${topic.name} (user=${topic.userId})`,
    );

    // ★ P1-CTX-BYOK (2026-04-30): wrap with userContext 让下游 AiChatService /
    //   BYOK key resolver 能拿到 topic.userId; 之前 BYOK-only 用户的定时刷新全 fail。
    try {
      await withUserContext(topic.userId, async () => {
        await this.orchestrator.executeRefresh(topic, { incremental: true });
      });
      this.logger.log(`Completed scheduled refresh for topic: ${topic.name}`);
    } catch (error) {
      // nextRefreshAt 已在闸②提前推进 → 本周期不会再被重选(无 retry storm),
      // 下一周期自然重试。这里只记录,不再 rethrow。
      this.logger.error(
        `Scheduled refresh failed for topic ${topic.name} (will retry next cycle)`,
        error,
      );
    }
  }

  /**
   * 计算下次刷新时间
   */
  calculateNextRefreshTime(frequency: RefreshFrequency): Date {
    const now = new Date();

    switch (frequency) {
      case RefreshFrequency.DAILY:
        return new Date(now.getTime() + 24 * 60 * 60 * 1000);

      case RefreshFrequency.WEEKLY:
        return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      case RefreshFrequency.BIWEEKLY:
        return new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

      case RefreshFrequency.MONTHLY: {
        // 月末溢出修正：setMonth 在 5/31 +1 月会溢出到 7/1（6 月仅 30 天），
        // 导致月末 topic 被排到 ~2 个月后。若发生跳月，用 setDate(0) 回退到
        // 目标月最后一天（如 6/30）。
        const nextMonth = new Date(now);
        const targetMonth = nextMonth.getMonth() + 1;
        nextMonth.setMonth(targetMonth);
        if (nextMonth.getMonth() !== targetMonth % 12) {
          nextMonth.setDate(0);
        }
        return nextMonth;
      }

      case RefreshFrequency.MANUAL:
      default:
        return new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // 一年后
    }
  }

  /**
   * 更新所有专题的下次刷新时间
   */
  async updateNextRefreshTimes(): Promise<void> {
    const topics = await this.prisma.researchTopic.findMany({
      where: {
        status: ResearchTopicStatus.ACTIVE,
        refreshFrequency: { not: RefreshFrequency.MANUAL },
        nextRefreshAt: null,
      },
    });

    for (const topic of topics) {
      const nextRefreshAt = this.calculateNextRefreshTime(
        topic.refreshFrequency,
      );
      await this.prisma.researchTopic.update({
        where: { id: topic.id },
        data: { nextRefreshAt },
      });
    }

    if (topics.length > 0) {
      this.logger.log(`Updated next refresh times for ${topics.length} topics`);
    }
  }

  /**
   * 获取或创建专题的刷新计划
   */
  async getSchedule(topicId: string) {
    const topic = await this.prisma.researchTopic.findUnique({
      where: { id: topicId },
      select: {
        refreshFrequency: true,
        lastRefreshAt: true,
        nextRefreshAt: true,
      },
    });

    if (!topic) {
      return null;
    }

    // 检查是否有活跃的刷新计划
    const schedule = await this.prisma.topicSchedule.findFirst({
      where: { topicId, isActive: true },
    });

    return {
      frequency: topic.refreshFrequency,
      lastRefreshAt: topic.lastRefreshAt,
      nextRefreshAt: topic.nextRefreshAt,
      schedule,
    };
  }

  /**
   * 更新刷新计划
   */
  async updateSchedule(
    topicId: string,
    frequency: RefreshFrequency,
    options?: {
      dayOfWeek?: number;
      dayOfMonth?: number;
      hourOfDay?: number;
    },
  ) {
    // 更新专题的刷新频率
    const nextRefreshAt = this.calculateNextRefreshTime(frequency);

    await this.prisma.researchTopic.update({
      where: { id: topicId },
      data: {
        refreshFrequency: frequency,
        nextRefreshAt:
          frequency === RefreshFrequency.MANUAL ? null : nextRefreshAt,
      },
    });

    // 更新或创建计划记录
    const existingSchedule = await this.prisma.topicSchedule.findFirst({
      where: { topicId },
    });

    if (existingSchedule) {
      await this.prisma.topicSchedule.update({
        where: { id: existingSchedule.id },
        data: {
          frequency,
          dayOfWeek: options?.dayOfWeek,
          dayOfMonth: options?.dayOfMonth,
          hourOfDay: options?.hourOfDay ?? 9,
          isActive: frequency !== RefreshFrequency.MANUAL,
          nextRunAt:
            frequency === RefreshFrequency.MANUAL ? null : nextRefreshAt,
        },
      });
    } else {
      await this.prisma.topicSchedule.create({
        data: {
          topicId,
          frequency,
          dayOfWeek: options?.dayOfWeek,
          dayOfMonth: options?.dayOfMonth,
          hourOfDay: options?.hourOfDay ?? 9,
          isActive: frequency !== RefreshFrequency.MANUAL,
          nextRunAt:
            frequency === RefreshFrequency.MANUAL ? null : nextRefreshAt,
        },
      });
    }

    this.logger.log(`Updated schedule for topic ${topicId} to ${frequency}`);

    return this.getSchedule(topicId);
  }
}
