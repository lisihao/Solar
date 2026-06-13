/**
 * TopicRefreshScheduler Unit Tests
 *
 * Coverage targets:
 * - onModuleInit: initializes interval, calls updateNextRefreshTimes
 * - onModuleDestroy: clears interval
 * - checkAndRefreshTopics: no topics, topics found, P2021 error, generic error
 * - refreshTopic (private, tested via checkAndRefreshTopics): topic not found, success, error
 * - calculateNextRefreshTime: DAILY, WEEKLY, BIWEEKLY, MONTHLY, MANUAL/default
 * - updateNextRefreshTimes: no topics needing refresh, multiple topics updated
 * - getSchedule: topic not found (null), topic with existing schedule
 * - updateSchedule: new schedule (create), existing schedule (update), MANUAL frequency
 */

import { Test, TestingModule } from "@nestjs/testing";
import { RefreshFrequency, ResearchTopicStatus } from "@prisma/client";

import { TopicRefreshScheduler } from "../topic-refresh.scheduler";
import { PrismaService } from "@/common/prisma/prisma.service";
import { TopicTeamOrchestratorService } from "../../core/topic/topic-team-orchestrator.service";

// ============================================================================
// Helpers
// ============================================================================

function makeTopic(overrides: Record<string, unknown> = {}) {
  return {
    id: "topic-1",
    name: "Test Topic",
    status: ResearchTopicStatus.ACTIVE,
    refreshFrequency: RefreshFrequency.DAILY,
    nextRefreshAt: new Date(Date.now() - 1000), // already overdue
    lastRefreshAt: null,
    ...overrides,
  };
}

// ============================================================================
// Mock setup
// ============================================================================

function buildPrismaMock() {
  return {
    researchTopic: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      // ★ 2026-05-25 anti-runaway: 原子 claim 用 updateMany
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    researchMission: {
      // ★ 2026-05-25 anti-runaway: 闸① 查"是否已有进行中 mission"，默认无
      findFirst: jest.fn().mockResolvedValue(null),
    },
    topicSchedule: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
}

function buildOrchestratorMock() {
  return {
    executeRefresh: jest.fn().mockResolvedValue(undefined),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("TopicRefreshScheduler", () => {
  let scheduler: TopicRefreshScheduler;
  let prisma: ReturnType<typeof buildPrismaMock>;
  let orchestrator: ReturnType<typeof buildOrchestratorMock>;

  beforeEach(async () => {
    jest.useFakeTimers();
    prisma = buildPrismaMock();
    orchestrator = buildOrchestratorMock();

    // Default: no topics needing refresh on init
    prisma.researchTopic.findMany.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TopicRefreshScheduler,
        { provide: PrismaService, useValue: prisma },
        { provide: TopicTeamOrchestratorService, useValue: orchestrator },
      ],
    }).compile();

    scheduler = module.get<TopicRefreshScheduler>(TopicRefreshScheduler);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    delete process.env.ENABLE_TOPIC_AUTO_REFRESH;
  });

  // ==========================================================================
  // onModuleInit / onModuleDestroy
  // ==========================================================================

  describe("onModuleInit()", () => {
    // ★ 2026-05-25: 默认关闭，opt-in 的测试需显式开启
    beforeEach(() => {
      process.env.ENABLE_TOPIC_AUTO_REFRESH = "true";
    });

    it("is DISABLED by default (no env flag) — does not arm interval or scan topics", async () => {
      delete process.env.ENABLE_TOPIC_AUTO_REFRESH;
      const updateSpy = jest
        .spyOn(scheduler, "updateNextRefreshTimes")
        .mockResolvedValue();
      const setIntervalSpy = jest.spyOn(global, "setInterval");

      await scheduler.onModuleInit();

      expect(updateSpy).not.toHaveBeenCalled();
      expect(setIntervalSpy).not.toHaveBeenCalled();
    });

    it("should call updateNextRefreshTimes and set up an interval", async () => {
      const updateSpy = jest
        .spyOn(scheduler, "updateNextRefreshTimes")
        .mockResolvedValue();

      await scheduler.onModuleInit();

      expect(updateSpy).toHaveBeenCalledTimes(1);
    });

    it("should silently handle P2021 error during init (table not yet migrated)", async () => {
      const p2021Error = Object.assign(new Error("Table not found"), {
        code: "P2021",
      });
      jest
        .spyOn(scheduler, "updateNextRefreshTimes")
        .mockRejectedValue(p2021Error);

      // Should not throw
      await expect(scheduler.onModuleInit()).resolves.toBeUndefined();
    });

    it("should log error for non-P2021 errors during init", async () => {
      const genericError = new Error("Connection timeout");
      jest
        .spyOn(scheduler, "updateNextRefreshTimes")
        .mockRejectedValue(genericError);

      // Should not throw, but logs the error
      await expect(scheduler.onModuleInit()).resolves.toBeUndefined();
    });
  });

  describe("onModuleDestroy()", () => {
    it("should clear the interval when destroying the module", async () => {
      process.env.ENABLE_TOPIC_AUTO_REFRESH = "true"; // opt-in 才会装定时器
      const clearIntervalSpy = jest.spyOn(global, "clearInterval");
      jest.spyOn(scheduler, "updateNextRefreshTimes").mockResolvedValue();

      await scheduler.onModuleInit();
      scheduler.onModuleDestroy();

      expect(clearIntervalSpy).toHaveBeenCalled();
    });

    it("should be safe to call onModuleDestroy before onModuleInit", () => {
      // intervalHandle is null before init, should not throw
      expect(() => scheduler.onModuleDestroy()).not.toThrow();
    });
  });

  // ==========================================================================
  // checkAndRefreshTopics
  // ==========================================================================

  describe("checkAndRefreshTopics()", () => {
    it("should return early when no topics need refresh", async () => {
      prisma.researchTopic.findMany.mockResolvedValue([]);

      await scheduler.checkAndRefreshTopics();

      expect(orchestrator.executeRefresh).not.toHaveBeenCalled();
    });

    it("should refresh all topics that are overdue", async () => {
      const topics = [
        makeTopic({ id: "topic-1" }),
        makeTopic({ id: "topic-2", refreshFrequency: RefreshFrequency.WEEKLY }),
      ];
      prisma.researchTopic.findMany.mockResolvedValue(topics);
      prisma.researchTopic.findUnique
        .mockResolvedValueOnce(topics[0])
        .mockResolvedValueOnce(topics[1]);

      await scheduler.checkAndRefreshTopics();

      expect(orchestrator.executeRefresh).toHaveBeenCalledTimes(2);
      // ★ claim 改用 updateMany(执行前推进 next_refresh_at),不再用 update(完成后)
      expect(prisma.researchTopic.updateMany).toHaveBeenCalledTimes(2);
    });

    it("should handle P2021 error gracefully (table does not exist)", async () => {
      const p2021Error = Object.assign(new Error("Table not found"), {
        code: "P2021",
      });
      prisma.researchTopic.findMany.mockRejectedValue(p2021Error);

      // Should not throw
      await expect(scheduler.checkAndRefreshTopics()).resolves.toBeUndefined();
    });

    it("should log error for non-P2021 errors during check", async () => {
      const genericError = new Error("Network error");
      prisma.researchTopic.findMany.mockRejectedValue(genericError);

      // Should not throw
      await expect(scheduler.checkAndRefreshTopics()).resolves.toBeUndefined();
    });

    it("should continue processing remaining topics even if one fails", async () => {
      const topics = [
        makeTopic({ id: "topic-1" }),
        makeTopic({ id: "topic-2" }),
      ];
      prisma.researchTopic.findMany.mockResolvedValue(topics);
      // First topic fails, second succeeds
      prisma.researchTopic.findUnique
        .mockResolvedValueOnce(topics[0])
        .mockResolvedValueOnce(topics[1]);
      orchestrator.executeRefresh
        .mockRejectedValueOnce(new Error("Refresh failed"))
        .mockResolvedValueOnce(undefined);
      prisma.researchTopic.update.mockResolvedValue({});

      await scheduler.checkAndRefreshTopics();

      // Second topic should still have been attempted
      expect(orchestrator.executeRefresh).toHaveBeenCalledTimes(2);
    });

    it("should skip refreshTopic gracefully if topic not found during refresh", async () => {
      const topic = makeTopic();
      prisma.researchTopic.findMany.mockResolvedValue([topic]);
      prisma.researchTopic.findUnique.mockResolvedValue(null); // topic gone by refresh time

      await scheduler.checkAndRefreshTopics();

      expect(orchestrator.executeRefresh).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // anti-runaway guards (2026-05-25 失控事故回归)
  // ==========================================================================

  describe("refreshTopic anti-runaway guards", () => {
    it("闸①: skips refresh when an in-flight mission already exists for the topic", async () => {
      const topic = makeTopic();
      prisma.researchTopic.findMany.mockResolvedValue([topic]);
      prisma.researchTopic.findUnique.mockResolvedValue(topic);
      // 已有进行中的 mission
      prisma.researchMission.findFirst.mockResolvedValue({
        id: "mission-live",
      });

      await scheduler.checkAndRefreshTopics();

      expect(orchestrator.executeRefresh).not.toHaveBeenCalled();
      // 不抢 claim，也不推进 next_refresh_at
      expect(prisma.researchTopic.updateMany).not.toHaveBeenCalled();
    });

    it("闸②: atomically claims (advances next_refresh_at) BEFORE executeRefresh", async () => {
      const topic = makeTopic();
      prisma.researchTopic.findMany.mockResolvedValue([topic]);
      prisma.researchTopic.findUnique.mockResolvedValue(topic);

      const order: string[] = [];
      prisma.researchTopic.updateMany.mockImplementation(async () => {
        order.push("claim");
        return { count: 1 };
      });
      orchestrator.executeRefresh.mockImplementation(async () => {
        order.push("execute");
      });

      await scheduler.checkAndRefreshTopics();

      // claim 必须在 execute 之前
      expect(order).toEqual(["claim", "execute"]);
      const claimArg = prisma.researchTopic.updateMany.mock.calls[0][0];
      expect(claimArg.where).toMatchObject({ id: "topic-1" });
      expect(claimArg.where.nextRefreshAt).toBeDefined(); // 仅当仍到期才抢到
      expect(claimArg.data.nextRefreshAt).toBeInstanceOf(Date);
    });

    it("闸②: skips executeRefresh when the claim loses the race (count=0)", async () => {
      const topic = makeTopic();
      prisma.researchTopic.findMany.mockResolvedValue([topic]);
      prisma.researchTopic.findUnique.mockResolvedValue(topic);
      prisma.researchMission.findFirst.mockResolvedValue(null);
      prisma.researchTopic.updateMany.mockResolvedValue({ count: 0 }); // 别的 tick/pod 抢走了

      await scheduler.checkAndRefreshTopics();

      expect(orchestrator.executeRefresh).not.toHaveBeenCalled();
    });

    it("on executeRefresh failure: does NOT rethrow and does NOT re-storm (next_refresh_at already advanced)", async () => {
      const topic = makeTopic();
      prisma.researchTopic.findMany.mockResolvedValue([topic]);
      prisma.researchTopic.findUnique.mockResolvedValue(topic);
      orchestrator.executeRefresh.mockRejectedValue(new Error("boom"));

      await expect(scheduler.checkAndRefreshTopics()).resolves.toBeUndefined();

      // claim 已提前推进过 next_refresh_at；失败后不应再有"完成后回写"的 update
      expect(prisma.researchTopic.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.researchTopic.update).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // calculateNextRefreshTime
  // ==========================================================================

  describe("calculateNextRefreshTime()", () => {
    const MS_PER_HOUR = 60 * 60 * 1000;

    it("should return a date ~24 hours ahead for DAILY", () => {
      const before = Date.now();
      const result = scheduler.calculateNextRefreshTime(RefreshFrequency.DAILY);
      const after = Date.now();

      const expected = 24 * MS_PER_HOUR;
      expect(result.getTime() - before).toBeGreaterThanOrEqual(expected - 100);
      expect(result.getTime() - after).toBeLessThanOrEqual(expected + 100);
    });

    it("should return a date ~7 days ahead for WEEKLY", () => {
      const before = Date.now();
      const result = scheduler.calculateNextRefreshTime(
        RefreshFrequency.WEEKLY,
      );

      const expected = 7 * 24 * MS_PER_HOUR;
      expect(result.getTime() - before).toBeGreaterThanOrEqual(expected - 100);
    });

    it("should return a date ~14 days ahead for BIWEEKLY", () => {
      const before = Date.now();
      const result = scheduler.calculateNextRefreshTime(
        RefreshFrequency.BIWEEKLY,
      );

      const expected = 14 * 24 * MS_PER_HOUR;
      expect(result.getTime() - before).toBeGreaterThanOrEqual(expected - 100);
    });

    it("should return a date ~1 month ahead for MONTHLY", () => {
      const result = scheduler.calculateNextRefreshTime(
        RefreshFrequency.MONTHLY,
      );
      const now = new Date();
      const expectedMonth = (now.getMonth() + 1) % 12;

      expect(result.getMonth()).toBe(expectedMonth);
    });

    // 月末溢出边界（固定系统时间，不依赖运行日期）——
    // 原 setMonth(+1) 在 5/31、1/31 等月末会溢出到下下月，已用 clamp 修复。
    it("MONTHLY 月末防溢出：5/31 → 6/30（非 7/1）", () => {
      jest.useFakeTimers().setSystemTime(new Date(2026, 4, 31, 12, 0, 0));
      try {
        const result = scheduler.calculateNextRefreshTime(
          RefreshFrequency.MONTHLY,
        );
        expect(result.getMonth()).toBe(5); // 6 月
        expect(result.getDate()).toBe(30);
      } finally {
        jest.useRealTimers();
      }
    });

    it("MONTHLY 月末防溢出：1/31 → 2/28（平年）", () => {
      jest.useFakeTimers().setSystemTime(new Date(2026, 0, 31, 12, 0, 0));
      try {
        const result = scheduler.calculateNextRefreshTime(
          RefreshFrequency.MONTHLY,
        );
        expect(result.getMonth()).toBe(1); // 2 月
        expect(result.getDate()).toBe(28);
      } finally {
        jest.useRealTimers();
      }
    });

    it("MONTHLY 闰年：1/31 → 2/29（2028 闰年）", () => {
      jest.useFakeTimers().setSystemTime(new Date(2028, 0, 31, 12, 0, 0));
      try {
        const result = scheduler.calculateNextRefreshTime(
          RefreshFrequency.MONTHLY,
        );
        expect(result.getMonth()).toBe(1);
        expect(result.getDate()).toBe(29);
      } finally {
        jest.useRealTimers();
      }
    });

    it("MONTHLY 跨年：12/15 → 次年 1/15", () => {
      jest.useFakeTimers().setSystemTime(new Date(2026, 11, 15, 12, 0, 0));
      try {
        const result = scheduler.calculateNextRefreshTime(
          RefreshFrequency.MONTHLY,
        );
        expect(result.getFullYear()).toBe(2027);
        expect(result.getMonth()).toBe(0); // 1 月
        expect(result.getDate()).toBe(15);
      } finally {
        jest.useRealTimers();
      }
    });

    it("should return a date ~1 year ahead for MANUAL", () => {
      const before = Date.now();
      const result = scheduler.calculateNextRefreshTime(
        RefreshFrequency.MANUAL,
      );

      const expected = 365 * 24 * MS_PER_HOUR;
      expect(result.getTime() - before).toBeGreaterThanOrEqual(expected - 1000);
    });

    it("should return a future date (result > now)", () => {
      for (const freq of Object.values(RefreshFrequency)) {
        const result = scheduler.calculateNextRefreshTime(freq);
        expect(result.getTime()).toBeGreaterThan(Date.now());
      }
    });
  });

  // ==========================================================================
  // updateNextRefreshTimes
  // ==========================================================================

  describe("updateNextRefreshTimes()", () => {
    it("should do nothing when no topics need refresh time updates", async () => {
      prisma.researchTopic.findMany.mockResolvedValue([]);

      await scheduler.updateNextRefreshTimes();

      expect(prisma.researchTopic.update).not.toHaveBeenCalled();
    });

    it("should update nextRefreshAt for each topic missing it", async () => {
      const topics = [
        makeTopic({
          id: "topic-1",
          nextRefreshAt: null,
          refreshFrequency: RefreshFrequency.DAILY,
        }),
        makeTopic({
          id: "topic-2",
          nextRefreshAt: null,
          refreshFrequency: RefreshFrequency.WEEKLY,
        }),
      ];
      prisma.researchTopic.findMany.mockResolvedValue(topics);
      prisma.researchTopic.update.mockResolvedValue({});

      await scheduler.updateNextRefreshTimes();

      expect(prisma.researchTopic.update).toHaveBeenCalledTimes(2);
      expect(prisma.researchTopic.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "topic-1" },
          data: { nextRefreshAt: expect.any(Date) },
        }),
      );
    });

    it("should query only ACTIVE topics with no nextRefreshAt", async () => {
      prisma.researchTopic.findMany.mockResolvedValue([]);

      await scheduler.updateNextRefreshTimes();

      expect(prisma.researchTopic.findMany).toHaveBeenCalledWith({
        where: {
          status: ResearchTopicStatus.ACTIVE,
          refreshFrequency: { not: RefreshFrequency.MANUAL },
          nextRefreshAt: null,
        },
      });
    });
  });

  // ==========================================================================
  // getSchedule
  // ==========================================================================

  describe("getSchedule()", () => {
    it("should return null when topic does not exist", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue(null);

      const result = await scheduler.getSchedule("non-existent-topic");

      expect(result).toBeNull();
    });

    it("should return schedule info with frequency and timestamps", async () => {
      const topic = {
        refreshFrequency: RefreshFrequency.DAILY,
        lastRefreshAt: new Date("2025-01-01"),
        nextRefreshAt: new Date("2025-01-02"),
      };
      const schedule = { id: "sched-1", isActive: true };

      prisma.researchTopic.findUnique.mockResolvedValue(topic);
      prisma.topicSchedule.findFirst.mockResolvedValue(schedule);

      const result = await scheduler.getSchedule("topic-1");

      expect(result).toEqual({
        frequency: RefreshFrequency.DAILY,
        lastRefreshAt: topic.lastRefreshAt,
        nextRefreshAt: topic.nextRefreshAt,
        schedule,
      });
    });

    it("should return schedule with null schedule when none exists", async () => {
      const topic = {
        refreshFrequency: RefreshFrequency.WEEKLY,
        lastRefreshAt: null,
        nextRefreshAt: null,
      };
      prisma.researchTopic.findUnique.mockResolvedValue(topic);
      prisma.topicSchedule.findFirst.mockResolvedValue(null);

      const result = await scheduler.getSchedule("topic-1");

      expect(result).not.toBeNull();
      expect(result!.schedule).toBeNull();
      expect(result!.frequency).toBe(RefreshFrequency.WEEKLY);
    });
  });

  // ==========================================================================
  // updateSchedule
  // ==========================================================================

  describe("updateSchedule()", () => {
    it("should create a new schedule when none exists", async () => {
      prisma.researchTopic.update.mockResolvedValue({});
      prisma.topicSchedule.findFirst.mockResolvedValue(null);
      prisma.topicSchedule.create.mockResolvedValue({ id: "new-sched" });
      // getSchedule call at the end
      prisma.researchTopic.findUnique.mockResolvedValue({
        refreshFrequency: RefreshFrequency.DAILY,
        lastRefreshAt: null,
        nextRefreshAt: new Date(),
      });
      prisma.topicSchedule.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: "new-sched" });

      await scheduler.updateSchedule("topic-1", RefreshFrequency.DAILY);

      expect(prisma.topicSchedule.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            topicId: "topic-1",
            frequency: RefreshFrequency.DAILY,
            isActive: true,
          }),
        }),
      );
    });

    it("should update existing schedule", async () => {
      const existingSchedule = { id: "sched-existing" };
      prisma.researchTopic.update.mockResolvedValue({});
      prisma.topicSchedule.findFirst.mockResolvedValueOnce(existingSchedule);
      prisma.topicSchedule.update.mockResolvedValue({});
      prisma.researchTopic.findUnique.mockResolvedValue({
        refreshFrequency: RefreshFrequency.WEEKLY,
        lastRefreshAt: null,
        nextRefreshAt: new Date(),
      });
      prisma.topicSchedule.findFirst.mockResolvedValueOnce(existingSchedule);

      await scheduler.updateSchedule("topic-1", RefreshFrequency.WEEKLY, {
        dayOfWeek: 1,
        hourOfDay: 10,
      });

      expect(prisma.topicSchedule.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "sched-existing" },
          data: expect.objectContaining({
            frequency: RefreshFrequency.WEEKLY,
            dayOfWeek: 1,
            hourOfDay: 10,
            isActive: true,
          }),
        }),
      );
    });

    it("should set isActive to false and nextRunAt to null for MANUAL frequency", async () => {
      prisma.researchTopic.update.mockResolvedValue({});
      prisma.topicSchedule.findFirst.mockResolvedValueOnce(null);
      prisma.topicSchedule.create.mockResolvedValue({});
      prisma.researchTopic.findUnique.mockResolvedValue({
        refreshFrequency: RefreshFrequency.MANUAL,
        lastRefreshAt: null,
        nextRefreshAt: null,
      });
      prisma.topicSchedule.findFirst.mockResolvedValueOnce(null);

      await scheduler.updateSchedule("topic-1", RefreshFrequency.MANUAL);

      expect(prisma.researchTopic.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            nextRefreshAt: null,
          }),
        }),
      );
      expect(prisma.topicSchedule.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            isActive: false,
            nextRunAt: null,
          }),
        }),
      );
    });

    it("should use default hourOfDay of 9 when not specified", async () => {
      prisma.researchTopic.update.mockResolvedValue({});
      prisma.topicSchedule.findFirst.mockResolvedValueOnce(null);
      prisma.topicSchedule.create.mockResolvedValue({});
      prisma.researchTopic.findUnique.mockResolvedValue({
        refreshFrequency: RefreshFrequency.DAILY,
        lastRefreshAt: null,
        nextRefreshAt: new Date(),
      });
      prisma.topicSchedule.findFirst.mockResolvedValueOnce(null);

      await scheduler.updateSchedule("topic-1", RefreshFrequency.DAILY);

      expect(prisma.topicSchedule.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ hourOfDay: 9 }),
        }),
      );
    });
  });
});
