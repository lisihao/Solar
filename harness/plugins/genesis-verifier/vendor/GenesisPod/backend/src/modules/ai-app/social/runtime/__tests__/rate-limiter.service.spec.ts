import { Test, TestingModule } from "@nestjs/testing";
import { RateLimiterService } from "../rate-limiter.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { SocialPlatformType } from "../../mission/types";

describe("RateLimiterService", () => {
  let service: RateLimiterService;
  let mockPrisma: {
    socialPublishLog: {
      count: jest.Mock;
      findFirst: jest.Mock;
    };
    $executeRaw: jest.Mock;
  };

  beforeEach(async () => {
    mockPrisma = {
      socialPublishLog: {
        count: jest.fn(),
        findFirst: jest.fn(),
      },
      $executeRaw: jest.fn(),
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

  // ==================== canPublish - allowed ====================

  it("should allow publish when all limits are within bounds", async () => {
    mockPrisma.socialPublishLog.count.mockResolvedValue(0);
    mockPrisma.socialPublishLog.findFirst.mockResolvedValue(null);

    const result = await service.canPublish(
      "user-1",
      SocialPlatformType.WECHAT_MP,
    );

    expect(result.allowed).toBe(true);
    expect(result.remainingToday).toBeGreaterThan(0);
    expect(result.remainingThisHour).toBeGreaterThan(0);
  });

  it("should allow publish for xiaohongshu within limits", async () => {
    mockPrisma.socialPublishLog.count.mockResolvedValue(0);
    mockPrisma.socialPublishLog.findFirst.mockResolvedValue(null);

    const result = await service.canPublish(
      "user-1",
      SocialPlatformType.XIAOHONGSHU,
    );

    expect(result.allowed).toBe(true);
  });

  // ==================== canPublish - daily limit exceeded ====================

  it("should deny publish when daily limit exceeded for wechat", async () => {
    // WECHAT_MP maxPerDay = 1, so count >= 1 means exceeded
    mockPrisma.socialPublishLog.count
      .mockResolvedValueOnce(1) // today count
      .mockResolvedValueOnce(0); // hour count

    const result = await service.canPublish(
      "user-1",
      SocialPlatformType.WECHAT_MP,
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("今日发布已达上限");
    expect(result.remainingToday).toBe(0);
    expect(result.nextAvailableAt).toBeDefined();
    expect(result.nextAvailableAt).toBeInstanceOf(Date);
  });

  it("should deny publish when daily limit exceeded for xiaohongshu", async () => {
    // XIAOHONGSHU maxPerDay = 3
    mockPrisma.socialPublishLog.count
      .mockResolvedValueOnce(3) // today count
      .mockResolvedValueOnce(0); // hour count

    const result = await service.canPublish(
      "user-1",
      SocialPlatformType.XIAOHONGSHU,
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("今日发布已达上限");
  });

  it("should set nextAvailableAt to next day start when daily limit exceeded", async () => {
    mockPrisma.socialPublishLog.count
      .mockResolvedValueOnce(1) // today count = 1 >= maxPerDay(1)
      .mockResolvedValueOnce(0);

    const before = new Date();
    const result = await service.canPublish(
      "user-1",
      SocialPlatformType.WECHAT_MP,
    );
    const after = new Date();

    expect(result.allowed).toBe(false);
    expect(result.nextAvailableAt).toBeDefined();
    // nextAvailableAt should be tomorrow at midnight
    const tomorrow = new Date(before);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    expect(result.nextAvailableAt!.getTime()).toBeGreaterThanOrEqual(
      before.getTime(),
    );
    expect(result.nextAvailableAt!.getDate()).not.toBe(after.getDate());
  });

  // ==================== canPublish - hourly limit exceeded ====================

  it("should deny publish when hourly limit exceeded", async () => {
    mockPrisma.socialPublishLog.count
      .mockResolvedValueOnce(0) // today count
      .mockResolvedValueOnce(1); // hour count >= maxPerHour(1 for WECHAT_MP)

    const result = await service.canPublish(
      "user-1",
      SocialPlatformType.WECHAT_MP,
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("本小时发布已达上限");
    expect(result.remainingThisHour).toBe(0);
    expect(result.nextAvailableAt).toBeDefined();
  });

  // ==================== canPublish - interval check ====================

  it("should deny publish when minimum interval not met for xiaohongshu", async () => {
    mockPrisma.socialPublishLog.count
      .mockResolvedValueOnce(0) // today count
      .mockResolvedValueOnce(0); // hour count

    // Last publish was 60 minutes ago, but minInterval is 240 minutes for XHS
    const lastPublish = new Date(Date.now() - 60 * 60 * 1000);
    mockPrisma.socialPublishLog.findFirst
      .mockResolvedValueOnce({ createdAt: lastPublish }) // last success
      .mockResolvedValueOnce(null); // last fail

    const result = await service.canPublish(
      "user-1",
      SocialPlatformType.XIAOHONGSHU,
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("发布间隔不足");
    expect(result.nextAvailableAt).toBeDefined();
  });

  it("should allow publish when interval requirement met", async () => {
    mockPrisma.socialPublishLog.count
      .mockResolvedValueOnce(0) // today count
      .mockResolvedValueOnce(0); // hour count

    // Last publish was 250 minutes ago, minInterval for XHS is 240
    const lastPublish = new Date(Date.now() - 250 * 60 * 1000);
    mockPrisma.socialPublishLog.findFirst
      .mockResolvedValueOnce({ createdAt: lastPublish }) // last success
      .mockResolvedValueOnce(null); // last fail

    const result = await service.canPublish(
      "user-1",
      SocialPlatformType.XIAOHONGSHU,
    );

    expect(result.allowed).toBe(true);
  });

  // ==================== canPublish - cooldown after failure ====================

  it("should deny publish during cooldown after failure", async () => {
    mockPrisma.socialPublishLog.count
      .mockResolvedValueOnce(0) // today count
      .mockResolvedValueOnce(0); // hour count

    // WECHAT_MP: minIntervalMinutes = 0 so interval check is SKIPPED (no getLastPublishTime call).
    // cooldownAfterFailure = 30, so getLastFailTime IS called → first findFirst call is for fail time.
    mockPrisma.socialPublishLog.findFirst.mockResolvedValueOnce({
      createdAt: new Date(Date.now() - 5 * 60 * 1000),
    }); // last fail 5 min ago

    const result = await service.canPublish(
      "user-1",
      SocialPlatformType.WECHAT_MP,
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("冷却中");
    expect(result.nextAvailableAt).toBeDefined();
  });

  it("should allow publish after cooldown period expires", async () => {
    mockPrisma.socialPublishLog.count
      .mockResolvedValueOnce(0) // today count
      .mockResolvedValueOnce(0); // hour count

    // WECHAT_MP: minIntervalMinutes = 0, no interval check.
    // Last fail was 35 minutes ago, cooldown is 30 for WECHAT_MP → allowed
    mockPrisma.socialPublishLog.findFirst.mockResolvedValueOnce({
      createdAt: new Date(Date.now() - 35 * 60 * 1000),
    }); // last fail

    const result = await service.canPublish(
      "user-1",
      SocialPlatformType.WECHAT_MP,
    );

    expect(result.allowed).toBe(true);
  });

  // ==================== recordPublish ====================

  it("should call $executeRaw to record publish", async () => {
    mockPrisma.$executeRaw.mockResolvedValue(1);

    await service.recordPublish("user-1", SocialPlatformType.WECHAT_MP, true);

    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("should record failed publish as well", async () => {
    mockPrisma.$executeRaw.mockResolvedValue(1);

    await service.recordPublish(
      "user-1",
      SocialPlatformType.XIAOHONGSHU,
      false,
    );

    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  // ==================== getConfig ====================

  it("should return rate limit config for wechat", () => {
    const config = service.getConfig(SocialPlatformType.WECHAT_MP);
    expect(config).toBeDefined();
    expect(config.maxPerDay).toBe(1);
    expect(config.maxPerHour).toBe(1);
    expect(config.cooldownAfterFailure).toBe(30);
  });

  it("should return rate limit config for xiaohongshu", () => {
    const config = service.getConfig(SocialPlatformType.XIAOHONGSHU);
    expect(config).toBeDefined();
    expect(config.maxPerDay).toBe(3);
    expect(config.maxPerHour).toBe(1);
    expect(config.minIntervalMinutes).toBe(240);
    expect(config.cooldownAfterFailure).toBe(60);
  });

  // ==================== getStatus ====================

  it("should return full status summary", async () => {
    mockPrisma.socialPublishLog.count.mockResolvedValue(0);
    mockPrisma.socialPublishLog.findFirst.mockResolvedValue(null);

    const status = await service.getStatus(
      "user-1",
      SocialPlatformType.WECHAT_MP,
    );

    expect(status.config).toBeDefined();
    expect(status.todayCount).toBe(0);
    expect(status.hourCount).toBe(0);
    expect(status.lastPublishAt).toBeNull();
    expect(status.canPublish).toBeDefined();
    expect(status.canPublish.allowed).toBe(true);
  });

  it("should return status with non-zero counts", async () => {
    mockPrisma.socialPublishLog.count.mockResolvedValue(1);
    mockPrisma.socialPublishLog.findFirst.mockResolvedValue({
      createdAt: new Date(),
    });

    const status = await service.getStatus(
      "user-1",
      SocialPlatformType.XIAOHONGSHU,
    );

    expect(status.todayCount).toBe(1);
    expect(status.hourCount).toBe(1);
    expect(status.lastPublishAt).toBeInstanceOf(Date);
  });

  // ==================== getRemainingCount ====================

  it("should include remaining today count in allowed result", async () => {
    // today count = 1, maxPerDay for XHS = 3, so remaining = 2
    mockPrisma.socialPublishLog.count
      .mockResolvedValueOnce(1) // today
      .mockResolvedValueOnce(0); // hour
    mockPrisma.socialPublishLog.findFirst.mockResolvedValue(null);

    const result = await service.canPublish(
      "user-1",
      SocialPlatformType.XIAOHONGSHU,
    );

    expect(result.allowed).toBe(true);
    expect(result.remainingToday).toBe(2);
    expect(result.remainingThisHour).toBe(1);
  });
});
