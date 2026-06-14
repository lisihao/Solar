/**
 * RadarRefreshScheduler — B7/B8/B9/B11/B18 新方法单元测试
 *
 * 覆盖：
 * - sweepDailyBriefing：时区门 + dedup + weekendSkip + 入队 + rate-limit silently drop
 * - sweepWeeklyBriefing：已存在跳过 + generateAndPersist + dispatch RADAR_WEEKLY
 * - onTier3Signal：非 tier3 ignore / Redis 超额 drop / site pref=false 跳过
 * - sweepBriefingsCleanup：正常删除 + 0 条跳过 log
 */
import { Test, TestingModule } from "@nestjs/testing";
import { RadarRefreshScheduler } from "../radar-refresh.scheduler";
import { PrismaService } from "@/common/prisma/prisma.service";
import { RadarPipelineDispatcher } from "../../../pipeline/radar-pipeline-dispatcher.service";
import { RadarBriefingQueueService } from "../radar-briefing-queue.service";
import { RadarDailyBriefingRepo } from "../../briefing/radar-daily-briefing.repo";
import { RadarWeeklyBriefingService } from "../../briefing/radar-weekly-briefing.service";
import { NotificationDispatcher } from "@/modules/platform/notifications/dispatcher/notification-dispatcher.service";
import { NotificationPreferenceService } from "@/modules/platform/notifications/dispatcher/preferences/notification-preference.service";
import { CacheService } from "@/common/cache/cache.service";
import { NarrativeService } from "../../briefing/narrative.service";
import { AIMetricsService } from "@/modules/platform/monitoring/metrics/ai-metrics.service";
import type { RadarBriefingSignalCreatedEvent } from "../../../pipeline/stages/s9-daily-top-n.stage";
import type { DailySignal } from "../../briefing/radar-daily-briefing.repo";

// ─── helpers ────────────────────────────────────────────────────────────────

function makeDailySignal(overrides: Partial<DailySignal> = {}): DailySignal {
  return {
    id: "sig-1",
    tier: 3,
    title: "NVIDIA Q1 财报超预期",
    oneLineTakeaway: "数据中心 +427% 验证算力需求未见顶",
    whyItMatters: "AI 资本支出仍处加速曲线",
    whatsNext: "关注 Q2 指引",
    signalTags: ["turning_point"],
    entities: ["NVIDIA"],
    evidenceItemIds: ["item-1"],
    score: 0.92,
    ...overrides,
  };
}

// ─── test suite ─────────────────────────────────────────────────────────────

describe("RadarRefreshScheduler — B7/B8/B9/B11/B18", () => {
  let scheduler: RadarRefreshScheduler;

  let mockPrisma: {
    radarRun: { count: jest.Mock; findFirst: jest.Mock };
    radarTopic: { findMany: jest.Mock };
  };
  let mockDispatcher: { runRefreshMission: jest.Mock };
  let mockBriefingQueue: { enqueue: jest.Mock };
  let mockDailyRepo: {
    findByTopicAndDate: jest.Mock;
    deleteOlderThan: jest.Mock;
  };
  let mockWeeklyService: {
    findInRange: jest.Mock;
    generateAndPersist: jest.Mock;
  };
  let mockNotificationDispatcher: { dispatch: jest.Mock };
  let mockPreferenceService: {
    get: jest.Mock;
    isInQuietHours: jest.Mock;
  };
  let mockCache: { incrby: jest.Mock; expire: jest.Mock };
  let mockDailyEmailPreset: { notify: jest.Mock };
  let mockWeeklyEmailPreset: { notify: jest.Mock };
  let mockNarrativeService: { getNarrativeThread: jest.Mock };
  let mockMetrics: { recordMetric: jest.Mock };

  beforeEach(async () => {
    mockPrisma = {
      radarRun: {
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      radarTopic: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue({ name: "Mock Topic" }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ locale: "zh-CN" }),
      },
    };
    mockDispatcher = { runRefreshMission: jest.fn() };
    mockBriefingQueue = {
      enqueue: jest.fn().mockResolvedValue({ enqueued: true, jobId: "j-1" }),
    };
    mockDailyRepo = {
      findByTopicAndDate: jest.fn().mockResolvedValue(null),
      deleteOlderThan: jest.fn().mockResolvedValue(0),
    };
    mockWeeklyService = {
      findInRange: jest.fn().mockResolvedValue([]),
      generateAndPersist: jest.fn().mockResolvedValue({
        id: "wb-1",
        payload: { tier3Count: 3, topSignals: [{}] },
      }),
    };
    mockNotificationDispatcher = {
      dispatch: jest.fn().mockResolvedValue({ delivered: true, results: [] }),
    };
    mockPreferenceService = {
      get: jest.fn().mockResolvedValue(null),
      isInQuietHours: jest.fn().mockResolvedValue(false),
    };
    mockCache = {
      incrby: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(undefined),
    };
    mockDailyEmailPreset = {
      notify: jest.fn().mockResolvedValue({ delivered: true, results: [] }),
    };
    mockWeeklyEmailPreset = {
      notify: jest.fn().mockResolvedValue({ delivered: true, results: [] }),
    };
    mockNarrativeService = {
      getNarrativeThread: jest.fn().mockResolvedValue(null),
    };
    mockMetrics = {
      recordMetric: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RadarRefreshScheduler,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RadarPipelineDispatcher, useValue: mockDispatcher },
        { provide: RadarBriefingQueueService, useValue: mockBriefingQueue },
        { provide: RadarDailyBriefingRepo, useValue: mockDailyRepo },
        { provide: RadarWeeklyBriefingService, useValue: mockWeeklyService },
        {
          provide: NotificationDispatcher,
          useValue: mockNotificationDispatcher,
        },
        {
          provide: NotificationPreferenceService,
          useValue: mockPreferenceService,
        },
        { provide: CacheService, useValue: mockCache },
        // FU2-D: scheduler 现注入 daily/weekly email preset；这里 mock 成 spy
        {
          provide:
            require("@/modules/platform/notifications/dispatcher/presets/radar-daily-briefing-email.preset")
              .RadarDailyBriefingEmailPreset,
          useValue: mockDailyEmailPreset,
        },
        {
          provide:
            require("@/modules/platform/notifications/dispatcher/presets/radar-weekly-briefing-email.preset")
              .RadarWeeklyBriefingEmailPreset,
          useValue: mockWeeklyEmailPreset,
        },
        { provide: NarrativeService, useValue: mockNarrativeService },
        { provide: AIMetricsService, useValue: mockMetrics },
      ],
    }).compile();

    scheduler = module.get(RadarRefreshScheduler);
  });

  // ────────────────────────────────────────────────────────────────────
  // B7 sweepDailyBriefing
  // ────────────────────────────────────────────────────────────────────
  describe("sweepDailyBriefing", () => {
    it("enqueues when topic briefingTime matches local time and no existing briefing", async () => {
      // topic with briefingTimezone 'UTC', briefingTime matching current UTC HH:mm
      const now = new Date();
      const hh = now.getUTCHours().toString().padStart(2, "0");
      const mm = now.getUTCMinutes().toString().padStart(2, "0");
      const briefingTime = `${hh}:${mm}`;

      mockPrisma.radarTopic.findMany.mockResolvedValueOnce([
        {
          id: "topic-1",
          userId: "user-1",
          briefingTime,
          briefingTimezone: "UTC",
          weekendSkip: false,
          user: { timezone: "UTC" },
        },
      ]);
      mockDailyRepo.findByTopicAndDate.mockResolvedValueOnce(null);
      mockBriefingQueue.enqueue.mockResolvedValueOnce({
        enqueued: true,
        jobId: "j-100",
      });

      await scheduler.sweepDailyBriefing();

      expect(mockBriefingQueue.enqueue).toHaveBeenCalledWith(
        "user-1",
        expect.objectContaining({ type: "daily", topicId: "topic-1" }),
      );
    });

    it("skips topic when briefingTime does NOT match local time", async () => {
      // briefingTime set to one hour from now, should not match
      const now = new Date();
      const offsetHour = (now.getUTCHours() + 2) % 24;
      const briefingTime = `${offsetHour.toString().padStart(2, "0")}:00`;

      mockPrisma.radarTopic.findMany.mockResolvedValueOnce([
        {
          id: "topic-2",
          userId: "user-2",
          briefingTime,
          briefingTimezone: "UTC",
          weekendSkip: false,
          user: { timezone: "UTC" },
        },
      ]);

      await scheduler.sweepDailyBriefing();

      expect(mockBriefingQueue.enqueue).not.toHaveBeenCalled();
    });

    it("skips topic when today briefing already exists", async () => {
      const now = new Date();
      const hh = now.getUTCHours().toString().padStart(2, "0");
      const mm = now.getUTCMinutes().toString().padStart(2, "0");

      mockPrisma.radarTopic.findMany.mockResolvedValueOnce([
        {
          id: "topic-3",
          userId: "user-3",
          briefingTime: `${hh}:${mm}`,
          briefingTimezone: "UTC",
          weekendSkip: false,
          user: { timezone: "UTC" },
        },
      ]);
      // Simulate existing briefing
      mockDailyRepo.findByTopicAndDate.mockResolvedValueOnce({
        id: "existing-briefing",
        status: "completed",
      });

      await scheduler.sweepDailyBriefing();

      expect(mockBriefingQueue.enqueue).not.toHaveBeenCalled();
    });

    it("silently accepts rate-limited result without throwing", async () => {
      const now = new Date();
      const hh = now.getUTCHours().toString().padStart(2, "0");
      const mm = now.getUTCMinutes().toString().padStart(2, "0");

      mockPrisma.radarTopic.findMany.mockResolvedValueOnce([
        {
          id: "topic-4",
          userId: "user-4",
          briefingTime: `${hh}:${mm}`,
          briefingTimezone: "UTC",
          weekendSkip: false,
          user: { timezone: "UTC" },
        },
      ]);
      mockBriefingQueue.enqueue.mockResolvedValueOnce({
        enqueued: false,
        reason: "rate-limited",
      });

      // Should NOT throw
      await expect(scheduler.sweepDailyBriefing()).resolves.toBeUndefined();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // B8 sweepWeeklyBriefing
  // ────────────────────────────────────────────────────────────────────
  describe("sweepWeeklyBriefing", () => {
    it("generates and dispatches RADAR_WEEKLY when no existing weekly briefing", async () => {
      mockPrisma.radarTopic.findMany.mockResolvedValueOnce([
        {
          id: "topic-5",
          userId: "user-5",
          briefingTimezone: "UTC",
          user: { timezone: "UTC" },
        },
      ]);
      mockWeeklyService.findInRange.mockResolvedValueOnce([]);
      mockWeeklyService.generateAndPersist.mockResolvedValueOnce({
        id: "wb-5",
        payload: { tier3Count: 2, topSignals: [{}] },
      });

      await scheduler.sweepWeeklyBriefing();

      expect(mockWeeklyService.generateAndPersist).toHaveBeenCalledWith(
        expect.objectContaining({
          topicId: "topic-5",
          userId: "user-5",
        }),
      );
      // dispatch is fire-and-forget via void preset.notify().catch — flush microtasks
      await Promise.resolve();
      // FU2-D: dispatch 走 weeklyEmailPreset.notify（preset 内部再调 dispatcher）
      expect(mockWeeklyEmailPreset.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-5",
          topicId: "topic-5",
        }),
      );
    });

    it("skips generateAndPersist when weekly briefing already exists for this week", async () => {
      mockPrisma.radarTopic.findMany.mockResolvedValueOnce([
        {
          id: "topic-6",
          userId: "user-6",
          briefingTimezone: "UTC",
          user: { timezone: "UTC" },
        },
      ]);
      mockWeeklyService.findInRange.mockResolvedValueOnce([{ id: "existing" }]);

      await scheduler.sweepWeeklyBriefing();

      expect(mockWeeklyService.generateAndPersist).not.toHaveBeenCalled();
      expect(mockWeeklyEmailPreset.notify).not.toHaveBeenCalled();
    });

    it("skips dispatch when generated weekly has no signals", async () => {
      mockPrisma.radarTopic.findMany.mockResolvedValueOnce([
        {
          id: "topic-7",
          userId: "user-7",
          briefingTimezone: "UTC",
          user: { timezone: "UTC" },
        },
      ]);
      mockWeeklyService.findInRange.mockResolvedValueOnce([]);
      mockWeeklyService.generateAndPersist.mockResolvedValueOnce({
        id: "wb-7",
        payload: { tier3Count: 0, topSignals: [] },
      });

      await scheduler.sweepWeeklyBriefing();

      await Promise.resolve();
      expect(mockWeeklyEmailPreset.notify).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // B9 onTier3Signal
  // ────────────────────────────────────────────────────────────────────
  describe("onTier3Signal", () => {
    it("silently returns without dispatch when tier is not 3", async () => {
      const payload: RadarBriefingSignalCreatedEvent = {
        userId: "user-8",
        topicId: "topic-8",
        signal: makeDailySignal({ tier: 2 }),
      };

      await scheduler.onTier3Signal(payload);

      expect(mockNotificationDispatcher.dispatch).not.toHaveBeenCalled();
      expect(mockCache.incrby).not.toHaveBeenCalled();
    });

    it("drops and warns when Redis count exceeds 3 per topic per day", async () => {
      // INCR returns 4 (> limit of 3)
      mockCache.incrby.mockResolvedValueOnce(4);

      const payload: RadarBriefingSignalCreatedEvent = {
        userId: "user-9",
        topicId: "topic-9",
        signal: makeDailySignal({ tier: 3 }),
      };

      await scheduler.onTier3Signal(payload);

      // P1-C: key 含 userId 段防共享 topic 串扰
      expect(mockCache.incrby).toHaveBeenCalledWith(
        expect.stringContaining("radar:tier3:user-9:topic-9:"),
        1,
      );
      // dispatch should NOT be called
      expect(mockNotificationDispatcher.dispatch).not.toHaveBeenCalled();
    });

    it("dispatches RADAR_TIER3_INSTANT with excludeChannels=[email] when tier=3 and count<=3", async () => {
      mockCache.incrby.mockResolvedValueOnce(1);
      mockPreferenceService.get.mockResolvedValueOnce(null); // no pref
      mockPreferenceService.isInQuietHours.mockResolvedValueOnce(false);

      const signal = makeDailySignal({ tier: 3, id: "sig-tier3" });
      const payload: RadarBriefingSignalCreatedEvent = {
        userId: "user-10",
        topicId: "topic-10",
        signal,
      };

      await scheduler.onTier3Signal(payload);
      // flush the fire-and-forget void promise
      await Promise.resolve();

      expect(mockNotificationDispatcher.dispatch).toHaveBeenCalledWith(
        "user-10",
        expect.objectContaining({
          type: "RADAR_TIER3_INSTANT",
          priority: "high",
        }),
        expect.objectContaining({ excludeChannels: ["email"] }),
      );
    });

    it("skips dispatch when user pref has site=false for RADAR_TIER3_INSTANT", async () => {
      mockPreferenceService.get.mockResolvedValueOnce({
        channelSubscriptions: {
          RADAR_TIER3_INSTANT: { site: false },
        },
        quietHoursStart: null,
        quietHoursEnd: null,
      });

      const payload: RadarBriefingSignalCreatedEvent = {
        userId: "user-11",
        topicId: "topic-11",
        signal: makeDailySignal({ tier: 3 }),
      };

      await scheduler.onTier3Signal(payload);

      expect(mockCache.incrby).not.toHaveBeenCalled();
      expect(mockNotificationDispatcher.dispatch).not.toHaveBeenCalled();
    });

    it("skips dispatch when user is in quiet hours", async () => {
      mockPreferenceService.get.mockResolvedValueOnce(null);
      mockPreferenceService.isInQuietHours.mockResolvedValueOnce(true);

      const payload: RadarBriefingSignalCreatedEvent = {
        userId: "user-12",
        topicId: "topic-12",
        signal: makeDailySignal({ tier: 3 }),
      };

      await scheduler.onTier3Signal(payload);

      expect(mockCache.incrby).not.toHaveBeenCalled();
      expect(mockNotificationDispatcher.dispatch).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // B18 sweepBriefingsCleanup
  // ────────────────────────────────────────────────────────────────────
  describe("sweepBriefingsCleanup", () => {
    it("calls deleteOlderThan with 90-day cutoff and logs when rows deleted", async () => {
      mockDailyRepo.deleteOlderThan.mockResolvedValueOnce(15);

      await scheduler.sweepBriefingsCleanup();

      const [cutoff] = mockDailyRepo.deleteOlderThan.mock.calls[0] as [Date];
      // cutoff should be roughly 90 days ago
      const diffDays = (Date.now() - cutoff.getTime()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeGreaterThanOrEqual(89);
      expect(diffDays).toBeLessThanOrEqual(91);
    });

    it("does not throw when deleteOlderThan returns 0", async () => {
      mockDailyRepo.deleteOlderThan.mockResolvedValueOnce(0);

      await expect(scheduler.sweepBriefingsCleanup()).resolves.toBeUndefined();
    });

    it("catches and logs errors without throwing", async () => {
      mockDailyRepo.deleteOlderThan.mockRejectedValueOnce(
        new Error("DB timeout"),
      );

      await expect(scheduler.sweepBriefingsCleanup()).resolves.toBeUndefined();
    });
  });
});
