/**
 * RadarRefreshScheduler（彻底重构后）
 *
 * 每分钟 sweep ACTIVE 且 nextDueAt <= now 的 topic，fire-and-forget 调
 * RadarPipelineDispatcher.runRefreshMission（不再调自写 RadarCollectService）。
 *
 * 守门：
 *   - 同 topic 已有 status='running' 的 mission → 跳过
 *   - 单 user 同时 running >= 3 → 跳过该 user 后续 topic
 *   - 全局 running >= 20 → 整轮跳过（防 LLM 暴账）
 *   - 单轮处理 ≤ sweepBatchSize 个 topic
 *
 * PR-DR2-3 扩展（B7+B8+B9+B11+B18）：
 *   - sweepDailyBriefing：每分钟扫 ACTIVE topic，按用户时区判断 briefingTime，入队 daily job
 *   - sweepWeeklyBriefing：周日 18:00 UTC 扫 ACTIVE topic，直接生成周报 + dispatch
 *   - onTier3Signal：监听 radar.briefing.signal.created，tier=3 立即推送
 *   - sweepBriefingsCleanup：每日 02:00 UTC 清理 90 天前的 daily briefings
 */
import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { OnEvent } from "@nestjs/event-emitter";
import { RadarTopicStatus } from "@prisma/client";
import { PrismaService } from "@/common/prisma/prisma.service";
import { RADAR_SCHEDULER_DEFAULTS } from "../../../runtime/radar.constants";
import { RadarPipelineDispatcher } from "../../pipeline/radar-pipeline-dispatcher.service";
import { RadarBriefingQueueService } from "./radar-briefing-queue.service";
import { RadarDailyBriefingRepo } from "../briefing/radar-daily-briefing.repo";
import { RadarWeeklyBriefingService } from "../briefing/radar-weekly-briefing.service";
import { NarrativeService } from "../briefing/narrative.service";
import { AIMetricsService } from "@/modules/platform/monitoring/metrics/ai-metrics.service";
import { NotificationDispatcher } from "@/modules/platform/notifications/dispatcher/notification-dispatcher.service";
import { NotificationPreferenceService } from "@/modules/platform/notifications/dispatcher/preferences/notification-preference.service";
import { RadarDailyBriefingEmailPreset } from "@/modules/platform/notifications/dispatcher/presets/radar-daily-briefing-email.preset";
import { RadarWeeklyBriefingEmailPreset } from "@/modules/platform/notifications/dispatcher/presets/radar-weekly-briefing-email.preset";
import {
  RADAR_BRIEFING_GENERATED_METRIC,
  RADAR_BRIEFING_SIGNAL_CREATED_EVENT,
  type RadarBriefingGeneratedMetric,
  type RadarBriefingSignalCreatedEvent,
} from "../../pipeline/stages/s9-daily-top-n.stage";
import { CacheService } from "@/common/cache/cache.service";

@Injectable()
export class RadarRefreshScheduler {
  private readonly log = new Logger(RadarRefreshScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatcher: RadarPipelineDispatcher,
    private readonly briefingQueue: RadarBriefingQueueService,
    private readonly dailyRepo: RadarDailyBriefingRepo,
    private readonly weeklyService: RadarWeeklyBriefingService,
    private readonly notificationDispatcher: NotificationDispatcher,
    private readonly preferenceService: NotificationPreferenceService,
    private readonly cache: CacheService,
    private readonly dailyEmailPreset: RadarDailyBriefingEmailPreset,
    private readonly weeklyEmailPreset: RadarWeeklyBriefingEmailPreset,
    private readonly narrativeService: NarrativeService,
    private readonly metrics: AIMetricsService,
  ) {}

  /**
   * F5 (M2 observability) — RADAR_BRIEFING_GENERATED_METRIC 接 AIMetricsService。
   * 之前事件只用于 dispatch 邮件，observability 面板没 listener 收集；这里
   * 单独 `@OnEvent` 写入 mission_execution metric + metadata 供仪表盘聚合。
   */
  @OnEvent(RADAR_BRIEFING_GENERATED_METRIC)
  async onBriefingGeneratedMetric(
    metric: RadarBriefingGeneratedMetric,
  ): Promise<void> {
    try {
      await this.metrics.recordMetric({
        metricType: "mission_execution",
        operationId: metric.missionId,
        missionId: metric.missionId,
        userId: metric.userId,
        success: true,
        metadata: {
          module: "ai-radar",
          subType: "daily_briefing",
          topicId: metric.topicId,
          briefingDate: metric.briefingDate,
          candidatesCount: metric.candidatesCount,
          selectedCount: metric.selectedCount,
          tier3Count: metric.tier3Count,
          tier2Count: metric.tier2Count,
          tier1Count: metric.tier1Count,
          avgWhyItMattersLen: metric.avgWhyItMattersLen,
        },
      });
    } catch (err) {
      this.log.warn(
        `onBriefingGeneratedMetric record failed mission=${metric.missionId}: ${(err as Error).message}`,
      );
    }
  }

  @Cron(CronExpression.EVERY_MINUTE, {
    name: "radar-refresh-sweep",
    disabled: process.env.ENABLE_RADAR_SCHEDULER !== "true",
  })
  async sweep(): Promise<void> {
    const now = new Date();
    const globalRunning = await this.prisma.radarRun.count({
      where: { status: "running" },
    });
    if (globalRunning >= RADAR_SCHEDULER_DEFAULTS.globalConcurrencyLimit) {
      this.log.warn(
        `Global running=${globalRunning} >= limit ${RADAR_SCHEDULER_DEFAULTS.globalConcurrencyLimit}, skipping sweep`,
      );
      return;
    }

    const due = await this.prisma.radarTopic.findMany({
      where: {
        status: RadarTopicStatus.ACTIVE,
        OR: [{ nextDueAt: { lte: now } }, { nextDueAt: null }],
      },
      orderBy: { nextDueAt: { sort: "asc", nulls: "first" } },
      take: RADAR_SCHEDULER_DEFAULTS.sweepBatchSize,
    });
    if (due.length === 0) return;

    this.log.debug(
      `Sweep tick now=${now.toISOString()} due=${due.length} globalRunning=${globalRunning}`,
    );

    const userRunningCache = new Map<string, number>();
    for (const topic of due) {
      // 同 topic dedup（runMission 内部 createAtomic 还会兜底）
      const inflight = await this.prisma.radarRun.findFirst({
        where: { topicId: topic.id, status: "running" },
        select: { id: true },
      });
      if (inflight) continue;

      let userActive = userRunningCache.get(topic.userId);
      if (userActive === undefined) {
        userActive = await this.prisma.radarRun.count({
          where: { topic: { userId: topic.userId }, status: "running" },
        });
      }
      if (userActive >= RADAR_SCHEDULER_DEFAULTS.perUserConcurrencyLimit) {
        userRunningCache.set(topic.userId, userActive);
        continue;
      }
      userRunningCache.set(topic.userId, userActive + 1);

      void this.fireRefresh(topic.id, topic.userId, topic);
    }
  }

  /**
   * B7 — 每分钟扫描 ACTIVE topic，按用户本地时区判断 briefingTime 是否到达，入队 daily job。
   *
   * 流程：
   * 1. 查所有 ACTIVE topic（含 user.timezone）
   * 2. 用用户时区（topic.briefingTimezone ?? user.timezone ?? 'UTC'）判断当前本地时间是否匹配 briefingTime
   * 3. 跳过本日已生成的 topic（唯一约束查询）
   * 4. 跳过 weekendSkip=true 且今日是周六/周日的 topic
   * 5. 入队（K3 限流：全局 <=20 并发 + 用户 <=10/天；超额 silently drop）
   */
  @Cron(CronExpression.EVERY_MINUTE, {
    name: "radar-daily-briefing-sweep",
    disabled: process.env.ENABLE_RADAR_SCHEDULER !== "true",
  })
  async sweepDailyBriefing(): Promise<void> {
    const now = new Date();

    const topics = await this.prisma.radarTopic.findMany({
      where: { status: RadarTopicStatus.ACTIVE },
      select: {
        id: true,
        userId: true,
        briefingTime: true,
        briefingTimezone: true,
        weekendSkip: true,
        user: { select: { timezone: true } },
      },
    });
    if (topics.length === 0) return;

    for (const topic of topics) {
      try {
        const tz = topic.briefingTimezone ?? topic.user?.timezone ?? "UTC";
        const localHHMM = getLocalHHMM(now, tz);
        if (localHHMM !== topic.briefingTime) continue;

        // 跳过周末
        if (topic.weekendSkip) {
          const dayOfWeek = getLocalDayOfWeek(now, tz); // 0=Sun, 6=Sat
          if (dayOfWeek === 0 || dayOfWeek === 6) continue;
        }

        // 跳过今日已生成的
        const briefingDate = getLocalDateMidnight(now, tz);
        const existing = await this.dailyRepo.findByTopicAndDate(
          topic.id,
          briefingDate,
        );
        if (existing) continue;

        const briefingDateStr = briefingDate.toISOString().slice(0, 10);
        const result = await this.briefingQueue.enqueue(topic.userId, {
          type: "daily",
          topicId: topic.id,
          briefingDate: briefingDateStr,
        });

        if (!result.enqueued) {
          this.log.warn(
            `sweepDailyBriefing rate-limited: topic=${topic.id} user=${topic.userId} reason=${result.reason}`,
          );
        } else {
          this.log.debug(
            `sweepDailyBriefing enqueued: topic=${topic.id} jobId=${result.jobId} date=${briefingDateStr}`,
          );
        }
        // RADAR_DAILY dispatch 由 onDailyBriefingGenerated @OnEvent 在
        // S9 持久化后接力触发（不在 enqueue 路径），保证只在有 signals 时 dispatch
      } catch (err) {
        this.log.error(
          `sweepDailyBriefing topic=${topic.id} error: ${(err as Error).message}`,
        );
      }
    }
  }

  /**
   * B8 — 周日 18:00 UTC 扫描 ACTIVE topic，直接生成周报 + dispatch RADAR_WEEKLY。
   *
   * 流程：
   * 1. 查所有 ACTIVE topic（含 user.timezone）
   * 2. 按用户时区判断本地是否为周日（简化：UTC 周日 18:00 覆盖全球绝大多数时区当地周末）
   * 3. 跳过本周已生成 weekly briefing 的 topic
   * 4. 直接调 weeklyService.generateAndPersist（无 LLM，省成本）
   * 5. 生成完后 dispatch RADAR_WEEKLY（B11 同步路径）
   */
  @Cron("0 18 * * SUN", {
    timeZone: "UTC",
    name: "radar-weekly-briefing-sweep",
    // ★ 2026-05-25 默认关闭(opt-in):周报会发外部邮件 + 生成,属后台静默动作
    disabled: process.env.ENABLE_RADAR_SCHEDULER !== "true",
  })
  async sweepWeeklyBriefing(): Promise<void> {
    const now = new Date();
    // 本周 Monday 00:00 UTC ~ Sunday 23:59:59 UTC
    const { weekStart, weekEnd } = getWeekBounds(now);

    const topics = await this.prisma.radarTopic.findMany({
      where: { status: RadarTopicStatus.ACTIVE },
      select: {
        id: true,
        userId: true,
        briefingTimezone: true,
        user: { select: { timezone: true } },
      },
    });
    if (topics.length === 0) return;

    for (const topic of topics) {
      try {
        // 跳过本周已生成
        const existing = await this.weeklyService.findInRange(
          topic.id,
          weekStart,
          weekEnd,
        );
        if (existing.length > 0) continue;

        const weekly = await this.weeklyService.generateAndPersist({
          topicId: topic.id,
          userId: topic.userId,
          weekStart,
          weekEnd,
        });

        // B11 — dispatch RADAR_WEEKLY（同步路径；weekly 无 signals 时跳过避免 spam）
        const payload = weekly.payload as {
          topSignals?: unknown[];
          tier3Count?: number;
        };
        if (!payload.topSignals?.length && !payload.tier3Count) {
          this.log.debug(
            `sweepWeeklyBriefing skip dispatch — no signals: topic=${topic.id}`,
          );
          continue;
        }

        // FU2-D: weekly 切到 EmailPreset 走 HTML 渲染
        const user = await this.prisma.user.findUnique({
          where: { id: topic.userId },
          select: { locale: true },
        });
        const localeWeekly: "zh-CN" | "en-US" =
          user?.locale === "en-US" ? "en-US" : "zh-CN";
        const topicFull = await this.prisma.radarTopic.findUnique({
          where: { id: topic.id },
          select: { name: true },
        });
        const weeklyPayload = weekly.payload as WeeklyEmailPayload;
        const topSignals = (weeklyPayload.topSignals ?? []).map((s) => ({
          id: s.id,
          tier: s.tier,
          title: s.title,
          oneLineTakeaway: s.oneLineTakeaway,
          whyItMatters: s.whyItMatters,
          sourceBriefingDate: s.sourceBriefingDate,
          evidenceItemIds: s.evidenceItemIds ?? [],
        }));
        void this.weeklyEmailPreset
          .notify({
            userId: topic.userId,
            locale: localeWeekly,
            topicId: topic.id,
            topicName: topicFull?.name ?? "AI 雷达",
            weekStart: weekStart.toISOString().slice(0, 10),
            weekEnd: weekEnd.toISOString().slice(0, 10),
            topSignals,
            candidatesTotal: weeklyPayload.candidatesTotal ?? 0,
            narrativeCount: (weeklyPayload.narrativeMap ?? []).length,
            newEntityCount: (weeklyPayload.newEntities ?? []).length,
          })
          .catch((err: Error) =>
            this.log.warn(
              `RADAR_WEEKLY (preset) dispatch failed topic=${topic.id}: ${err.message}`,
            ),
          );

        this.log.log(
          `sweepWeeklyBriefing done: topic=${topic.id} weekStart=${weekStart.toISOString()}`,
        );
      } catch (err) {
        this.log.error(
          `sweepWeeklyBriefing topic=${topic.id} error: ${(err as Error).message}`,
        );
      }
    }
  }

  /**
   * B9 — 监听 radar.briefing.signal.created，tier=3 信号立即推送。
   *
   * 守门：
   * 1. tier !== 3 → silently return
   * 2. instantPushForTier3 主开关（channelSubscriptions[RADAR_TIER3_INSTANT]）→ 关则 return
   * 3. quietHours 静默时段 → return
   * 4. Redis INCR 频率闸 key=radar:tier3:{topicId}:{YYYY-MM-DD-UTC}，≤3/天；超额 drop + warn
   * 5. dispatch RADAR_TIER3_INSTANT（excludeChannels: ['email']，避 spam）
   */
  @OnEvent(RADAR_BRIEFING_SIGNAL_CREATED_EVENT)
  async onTier3Signal(payload: RadarBriefingSignalCreatedEvent): Promise<void> {
    if (payload.signal.tier !== 3) return;

    const { userId, topicId, signal } = payload;

    // instantPushForTier3 主开关（pref 读失败 → 走默认通知路径，不 block）
    const pref = await this.preferenceService.get(userId);
    if (pref) {
      const subs = (pref.channelSubscriptions ?? {}) as Record<
        string,
        Record<string, boolean>
      >;
      const tier3Pref = subs["RADAR_TIER3_INSTANT"];
      // 显式关闭 site channel = 主开关关
      if (
        tier3Pref &&
        typeof tier3Pref === "object" &&
        tier3Pref["site"] === false
      ) {
        return;
      }
    }

    // quietHours 检查
    const inQuiet = await this.preferenceService.isInQuietHours(userId);
    if (inQuiet) {
      this.log.debug(
        `onTier3Signal quietHours skip: user=${userId} signal=${signal.id}`,
      );
      return;
    }

    // Redis INCR 频率闸：每 user+topic 每天 ≤3 条
    // PR-DR2 P1-C (X8 安全评审整改) — 加 userId 段防共享 topic 串扰
    const today = new Date().toISOString().slice(0, 10);
    const rateLimitKey = `radar:tier3:${userId}:${topicId}:${today}`;
    let count: number;
    try {
      count = await this.cache.incrby(rateLimitKey, 1);
      if (count === 1) await this.cache.expire(rateLimitKey, 86400);
    } catch (err) {
      // fail-open: Redis 故障不阻塞推送
      this.log.warn(
        `onTier3Signal incrby failed (fail-open): ${(err as Error).message}`,
      );
      count = 1;
    }

    if (count > 3) {
      this.log.warn(
        `onTier3Signal rate-limited: topic=${topicId} count=${count} signal=${signal.id}`,
      );
      return;
    }

    // dispatch — tier3 不发 email 避 spam（产品决策）
    void this.notificationDispatcher
      .dispatch(
        userId,
        {
          type: "RADAR_TIER3_INSTANT",
          title: `[⭐⭐⭐] ${signal.title}`,
          message: signal.oneLineTakeaway,
          link: `/ai-radar/topic/${topicId}?signal=${signal.id}`,
          metadata: {
            signalId: signal.id,
            tier: 3,
            narrativeId: signal.narrativeId,
          },
          priority: "high",
        },
        { excludeChannels: ["email"] },
      )
      .catch((err: Error) =>
        this.log.warn(
          `RADAR_TIER3_INSTANT dispatch failed user=${userId} signal=${signal.id}: ${err.message}`,
        ),
      );
  }

  /**
   * P0-9 (X8 PM 评审整改) — RADAR_DAILY dispatch
   *
   * S9 持久化 daily briefing 后通过 EventEmitter2 触发
   * `radar.briefing.generated` metric 事件；这里 listen 之后
   * 调用 NotificationDispatcher dispatch RADAR_DAILY（仅 selectedCount>0
   * 时发送，no_signals 不打扰）。
   *
   * 守门：dispatcher 内部走偏好 + DispatcherQuota（fail-open），
   * 这里只负责"有内容才推送"。
   */
  @OnEvent(RADAR_BRIEFING_GENERATED_METRIC)
  async onDailyBriefingGenerated(
    metric: RadarBriefingGeneratedMetric,
  ): Promise<void> {
    if (metric.selectedCount === 0) {
      this.log.debug(
        `onDailyBriefingGenerated skip dispatch — no signals: topic=${metric.topicId}`,
      );
      return;
    }

    // FU2-D: 走 EmailPreset 渲染 HTML（之前仅 plaintext）
    // 拿 topic + user 信息 + 实际 signals（从 briefing row 反查）
    const [topic, user, briefing] = await Promise.all([
      this.prisma.radarTopic.findUnique({
        where: { id: metric.topicId },
        // PM P1: 拉 briefingTime（之前 hardcode 08:00 导致 06:30 用户收到邮件却显示 08:00）
        select: { id: true, name: true, briefingTime: true },
      }),
      this.prisma.user.findUnique({
        where: { id: metric.userId },
        select: { locale: true },
      }),
      this.dailyRepo.findByTopicAndDate(
        metric.topicId,
        new Date(`${metric.briefingDate}T00:00:00.000Z`),
      ),
    ]);
    if (!topic || !briefing) {
      this.log.warn(
        `onDailyBriefingGenerated topic/briefing missing — fallback plaintext dispatch`,
      );
      return;
    }
    const locale: "zh-CN" | "en-US" =
      user?.locale === "en-US" ? "en-US" : "zh-CN";
    const signals =
      (briefing.signals as unknown as DailySignalEmailLike[]) ?? [];

    // F2 修复：narrativeMap 拉取 — 按 signals.narrativeId 反查 NarrativeService
    // 注入模板 ctx，让 daily 邮件的"延续叙事"卡片真渲染（之前 silent miss）
    const narrativeMap = await this.buildNarrativeMap(metric.topicId, signals);
    const frontendBase = process.env.FRONTEND_URL ?? "http://localhost:3000";
    const narrativeMapCtx: Record<
      string,
      { label: string; episode: number; timelineUrl: string }
    > = {};
    for (const [narrId, thread] of narrativeMap.entries()) {
      narrativeMapCtx[narrId] = {
        label: thread.label,
        episode: thread.episodes.length,
        timelineUrl: `${frontendBase}/ai-radar/topic/${metric.topicId}?narrative=${encodeURIComponent(narrId)}`,
      };
    }

    void this.dailyEmailPreset
      .notify({
        userId: metric.userId,
        locale,
        topicId: metric.topicId,
        topicName: topic.name,
        briefingDate: metric.briefingDate,
        briefingTime: topic.briefingTime ?? "08:00",
        candidatesCount: metric.candidatesCount,
        signals: signals.map((s) => ({
          id: s.id,
          tier: s.tier,
          title: s.title,
          oneLineTakeaway: s.oneLineTakeaway,
          whyItMatters: s.whyItMatters,
          whatsNext: s.whatsNext,
          signalTags: s.signalTags ?? [],
          entities: s.entities ?? [],
          evidenceItemIds: s.evidenceItemIds ?? [],
          narrativeId: s.narrativeId ?? null,
        })),
        narrativeMap: narrativeMapCtx,
      })
      .catch((err: Error) =>
        this.log.warn(
          `RADAR_DAILY (preset) dispatch failed topic=${metric.topicId}: ${err.message}`,
        ),
      );

    this.log.log(
      `onDailyBriefingGenerated dispatched via preset: topic=${metric.topicId} signals=${metric.selectedCount}`,
    );
  }

  /**
   * B18 — 每日 02:00 UTC 清理超过 90 天的 daily briefings（决策 D1）。
   */
  @Cron("0 2 * * *", { name: "radar-briefings-cleanup" })
  async sweepBriefingsCleanup(): Promise<void> {
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - 90);
    cutoff.setUTCHours(0, 0, 0, 0);
    try {
      const deleted = await this.dailyRepo.deleteOlderThan(cutoff);
      if (deleted > 0) {
        this.log.log(
          `Daily briefing cleanup: deleted ${deleted} rows older than ${cutoff.toISOString()}`,
        );
      }
    } catch (err) {
      this.log.error(`sweepBriefingsCleanup failed: ${(err as Error).message}`);
    }
  }

  /**
   * F2 修复：按 signals.narrativeId 批量拉 NarrativeThread，去重组装 narrativeMap。
   * 同一 narrativeId 在 signals 里可能重复出现，只反查一次。
   * episode 总数 < 2 的（getNarrativeThread 返回 null）silent skip。
   */
  private async buildNarrativeMap(
    topicId: string,
    signals: { narrativeId?: string | null }[],
  ): Promise<
    Map<
      string,
      {
        label: string;
        episodes: {
          date: string;
          signalId: string;
          title: string;
          tier: 1 | 2 | 3;
        }[];
      }
    >
  > {
    const ids = new Set<string>();
    for (const s of signals) {
      if (s.narrativeId) ids.add(s.narrativeId);
    }
    if (ids.size === 0) return new Map();

    const result = new Map<
      string,
      {
        label: string;
        episodes: {
          date: string;
          signalId: string;
          title: string;
          tier: 1 | 2 | 3;
        }[];
      }
    >();
    for (const narrId of ids) {
      try {
        const thread = await this.narrativeService.getNarrativeThread(
          topicId,
          narrId,
        );
        if (thread) {
          result.set(narrId, {
            label: thread.label,
            episodes: thread.episodes,
          });
        }
      } catch (err) {
        this.log.warn(
          `buildNarrativeMap fetch failed topic=${topicId} narrative=${narrId}: ${(err as Error).message}`,
        );
      }
    }
    return result;
  }

  private async fireRefresh(
    topicId: string,
    userId: string,
    topic: {
      name: string;
      description: string | null;
      entityType: string | null;
      refreshCron: string;
      keywords: unknown;
    },
  ): Promise<void> {
    try {
      const summary = await this.dispatcher.runRefreshMission(
        {
          topicId,
          trigger: "SCHEDULED",
          topicName: topic.name,
          keywords: parseKeywords(topic.keywords),
          description: topic.description,
          entityType: topic.entityType,
          refreshCron: topic.refreshCron,
        },
        userId,
      );
      this.log.log(
        `Scheduled mission topic=${topicId} run=${summary.missionId} status=${summary.status}`,
      );
    } catch (err) {
      this.log.error(
        `Scheduled refresh topic=${topicId} failed: ${(err as Error).message}`,
      );
    }
  }
}

function parseKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

// FU2-D: 局部类型 alias，避免在 scheduler 强依赖 briefing 模块的 DailySignal 接口
interface DailySignalEmailLike {
  id: string;
  tier: 1 | 2 | 3;
  title: string;
  oneLineTakeaway: string;
  whyItMatters: string;
  whatsNext: string;
  signalTags?: string[];
  entities?: string[];
  evidenceItemIds?: string[];
  narrativeId?: string | null;
}

interface WeeklyEmailPayload {
  topSignals?: Array<{
    id: string;
    tier: 1 | 2 | 3;
    title: string;
    oneLineTakeaway: string;
    whyItMatters: string;
    sourceBriefingDate: string;
    evidenceItemIds?: string[];
  }>;
  candidatesTotal?: number;
  narrativeMap?: unknown[];
  newEntities?: unknown[];
}

/**
 * 返回 now 在指定 IANA 时区的本地 "HH:mm" 字符串。
 * 用 Intl.DateTimeFormat 获取时区感知的小时/分钟。
 * 如果时区无效，fallback 到 UTC。
 */
function getLocalHHMM(now: Date, tz: string): string {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const h = parts.find((p) => p.type === "hour")?.value ?? "00";
    const m = parts.find((p) => p.type === "minute")?.value ?? "00";
    // Intl hour12:false 可能给 "24" 代表午夜，标准化为 "00"
    const hh = h === "24" ? "00" : h.padStart(2, "0");
    return `${hh}:${m.padStart(2, "0")}`;
  } catch {
    // 时区无效 fallback UTC
    const h = now.getUTCHours().toString().padStart(2, "0");
    const m = now.getUTCMinutes().toString().padStart(2, "0");
    return `${h}:${m}`;
  }
}

/**
 * 返回 now 在指定时区的星期几（0=Sun, 1=Mon, ..., 6=Sat）。
 */
function getLocalDayOfWeek(now: Date, tz: string): number {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
    });
    const dayStr = fmt.format(now);
    const map: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    return map[dayStr] ?? now.getDay();
  } catch {
    return now.getUTCDay();
  }
}

/**
 * 返回 now 在指定时区的本地日期对应的 UTC 午夜 Date（用于 DB @db.Date 字段比对）。
 */
function getLocalDateMidnight(now: Date, tz: string): Date {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const ymd = fmt.format(now); // 'YYYY-MM-DD'
    return new Date(`${ymd}T00:00:00.000Z`);
  } catch {
    const ymd = now.toISOString().slice(0, 10);
    return new Date(`${ymd}T00:00:00.000Z`);
  }
}

/**
 * 返回当前周的 UTC 边界：Monday 00:00:00 ~ Sunday 23:59:59。
 */
function getWeekBounds(now: Date): { weekStart: Date; weekEnd: Date } {
  const day = now.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const daysToMonday = day === 0 ? 6 : day - 1;
  const weekStart = new Date(now);
  weekStart.setUTCDate(now.getUTCDate() - daysToMonday);
  weekStart.setUTCHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6);
  weekEnd.setUTCHours(23, 59, 59, 999);
  return { weekStart, weekEnd };
}
