/**
 * Tests for RateLimiterService
 */

import { Test, TestingModule } from "@nestjs/testing";
import { RateLimiterService } from "../runtime/rate-limiter.service";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { SocialPlatformType } from "../mission/types";

describe("RateLimiterService", () => {
  let service: RateLimiterService;
  let mockPrisma: {
    socialPublishLog: {
      count: jest.Mock;
      findFirst: jest.Mock;
    };
    $executeRaw: jest.Mock;
  };

  const userId = "user-test-123";

  beforeEach(async () => {
    mockPrisma = {
      socialPublishLog: {
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RateLimiterService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<RateLimiterService>(RateLimiterService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("canPublish", () => {
    describe("WECHAT_MP platform", () => {
      it("should allow publishing when all counts are zero", async () => {
        mockPrisma.socialPublishLog.count.mockResolvedValue(0);
        mockPrisma.socialPublishLog.findFirst.mockResolvedValue(null);

        const result = await service.canPublish(
          userId,
          SocialPlatformType.WECHAT_MP,
        );

        expect(result.allowed).toBe(true);
        expect(result.remainingToday).toBe(1); // maxPerDay - 0
        expect(result.remainingThisHour).toBe(1); // maxPerHour - 0
      });

      it("should deny when daily limit reached (maxPerDay=1)", async () => {
        mockPrisma.socialPublishLog.count.mockResolvedValue(1);

        const result = await service.canPublish(
          userId,
          SocialPlatformType.WECHAT_MP,
        );

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain("今日发布已达上限");
        expect(result.remainingToday).toBe(0);
        expect(result.nextAvailableAt).toBeDefined();
      });

      it("should deny when hourly limit reached", async () => {
        // First call (todayCount) returns 0, second call (hourCount) returns 1
        mockPrisma.socialPublishLog.count
          .mockResolvedValueOnce(0) // todayCount = 0 (under daily limit)
          .mockResolvedValueOnce(1); // hourCount = 1 (at hourly limit)

        const result = await service.canPublish(
          userId,
          SocialPlatformType.WECHAT_MP,
        );

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain("本小时发布已达上限");
        expect(result.nextAvailableAt).toBeDefined();
      });

      it("should deny when in failure cooldown (30 min)", async () => {
        mockPrisma.socialPublishLog.count.mockResolvedValue(0);
        // For WECHAT_MP: minIntervalMinutes=0, so step 3 (getLastPublishTime) is SKIPPED
        // Only step 4 (getLastFailTime) calls findFirst
        const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000);
        mockPrisma.socialPublishLog.findFirst.mockResolvedValueOnce({
          createdAt: tenMinsAgo,
        }); // last fail (only one call)

        const result = await service.canPublish(
          userId,
          SocialPlatformType.WECHAT_MP,
        );

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain("冷却中");
        expect(result.nextAvailableAt).toBeDefined();
      });

      it("should allow when cooldown period has passed", async () => {
        mockPrisma.socialPublishLog.count.mockResolvedValue(0);
        // For WECHAT_MP: minIntervalMinutes=0, so step 3 is SKIPPED
        // Last fail time is 31 minutes ago (cooldown is 30 min) - should be allowed
        const thirtyOneMinsAgo = new Date(Date.now() - 31 * 60 * 1000);
        mockPrisma.socialPublishLog.findFirst.mockResolvedValueOnce({
          createdAt: thirtyOneMinsAgo,
        }); // old fail - cooldown passed

        const result = await service.canPublish(
          userId,
          SocialPlatformType.WECHAT_MP,
        );

        expect(result.allowed).toBe(true);
      });
    });

    describe("XIAOHONGSHU platform", () => {
      it("should allow publishing when under all limits", async () => {
        mockPrisma.socialPublishLog.count.mockResolvedValue(0);
        mockPrisma.socialPublishLog.findFirst.mockResolvedValue(null);

        const result = await service.canPublish(
          userId,
          SocialPlatformType.XIAOHONGSHU,
        );

        expect(result.allowed).toBe(true);
        expect(result.remainingToday).toBe(3); // maxPerDay is 3
      });

      it("should deny when daily limit of 3 reached", async () => {
        mockPrisma.socialPublishLog.count.mockResolvedValue(3);

        const result = await service.canPublish(
          userId,
          SocialPlatformType.XIAOHONGSHU,
        );

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain("今日发布已达上限 (3篇)");
      });

      it("should deny when min interval (240 min) not met", async () => {
        mockPrisma.socialPublishLog.count.mockResolvedValue(0);
        // Last publish was 1 hour ago (60 min < 240 min interval)
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        mockPrisma.socialPublishLog.findFirst.mockResolvedValueOnce({
          createdAt: oneHourAgo,
        }); // last success

        const result = await service.canPublish(
          userId,
          SocialPlatformType.XIAOHONGSHU,
        );

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain("发布间隔不足");
      });

      it("should allow when interval has been met", async () => {
        mockPrisma.socialPublishLog.count.mockResolvedValue(0);
        // Last publish was 5 hours ago (300 min > 240 min interval)
        const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000);
        mockPrisma.socialPublishLog.findFirst
          .mockResolvedValueOnce({ createdAt: fiveHoursAgo }) // last success
          .mockResolvedValueOnce(null); // no fail

        const result = await service.canPublish(
          userId,
          SocialPlatformType.XIAOHONGSHU,
        );

        expect(result.allowed).toBe(true);
      });

      it("should deny when in failure cooldown (60 min)", async () => {
        mockPrisma.socialPublishLog.count.mockResolvedValue(0);
        const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);
        mockPrisma.socialPublishLog.findFirst
          .mockResolvedValueOnce(null) // no last success
          .mockResolvedValueOnce({ createdAt: thirtyMinsAgo }); // last fail 30 min ago

        const result = await service.canPublish(
          userId,
          SocialPlatformType.XIAOHONGSHU,
        );

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain("冷却中");
      });
    });
  });

  describe("recordPublish", () => {
    it("should execute raw SQL to record publish", async () => {
      await service.recordPublish(userId, SocialPlatformType.WECHAT_MP, true);

      expect(mockPrisma.$executeRaw).toHaveBeenCalled();
    });

    it("should record failed publish", async () => {
      await service.recordPublish(
        userId,
        SocialPlatformType.XIAOHONGSHU,
        false,
      );

      expect(mockPrisma.$executeRaw).toHaveBeenCalled();
    });
  });

  describe("getConfig", () => {
    it("should return WECHAT_MP rate limit config", () => {
      const config = service.getConfig(SocialPlatformType.WECHAT_MP);

      expect(config).toBeDefined();
      expect(config.maxPerDay).toBe(1);
      expect(config.maxPerHour).toBe(1);
      expect(config.cooldownAfterFailure).toBe(30);
    });

    it("should return XIAOHONGSHU rate limit config", () => {
      const config = service.getConfig(SocialPlatformType.XIAOHONGSHU);

      expect(config).toBeDefined();
      expect(config.maxPerDay).toBe(3);
      expect(config.minIntervalMinutes).toBe(240);
    });
  });

  describe("getStatus", () => {
    it("should return status summary with all fields", async () => {
      mockPrisma.socialPublishLog.count
        .mockResolvedValueOnce(0) // todayCount (first canPublish call via getStatus)
        .mockResolvedValueOnce(0) // hourCount (first canPublish call via getStatus)
        .mockResolvedValueOnce(0) // todayCount (internal canPublish call in getStatus)
        .mockResolvedValueOnce(0); // hourCount (internal canPublish call in getStatus)
      mockPrisma.socialPublishLog.findFirst.mockResolvedValue(null);

      const status = await service.getStatus(
        userId,
        SocialPlatformType.WECHAT_MP,
      );

      expect(status).toBeDefined();
      expect(status.config).toBeDefined();
      expect(status.config.maxPerDay).toBe(1);
      expect(status.todayCount).toBe(0);
      expect(status.hourCount).toBe(0);
      expect(status.lastPublishAt).toBeNull();
      expect(status.canPublish).toBeDefined();
      expect(status.canPublish.allowed).toBe(true);
    });

    it("should include lastPublishAt when there are recent publishes", async () => {
      const publishTime = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
      mockPrisma.socialPublishLog.count.mockResolvedValue(0);
      mockPrisma.socialPublishLog.findFirst
        .mockResolvedValueOnce({ createdAt: publishTime }) // getLastPublishTime (in getStatus)
        .mockResolvedValueOnce({ createdAt: publishTime }) // getLastPublishTime (in canPublish)
        .mockResolvedValueOnce(null); // getLastFailTime

      const status = await service.getStatus(
        userId,
        SocialPlatformType.WECHAT_MP,
      );

      expect(status.lastPublishAt).toEqual(publishTime);
    });
  });
});
