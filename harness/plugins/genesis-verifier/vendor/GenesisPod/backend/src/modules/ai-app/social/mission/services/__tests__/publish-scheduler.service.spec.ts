import { Logger } from "@nestjs/common";
import { PublishSchedulerService } from "../publish-scheduler.service";
import { SocialContentStatus } from "../../types";

describe("PublishSchedulerService", () => {
  let service: PublishSchedulerService;
  let prisma: {
    socialContent: { findMany: jest.Mock; updateMany: jest.Mock };
  };
  let dispatcher: { tryReserveInFlight: jest.Mock; runMission: jest.Mock };
  let configService: { get: jest.Mock };

  // PR-2: scheduler 切到 dispatcher.runMission（fast-track depth=quick）。
  // 单测 mock 出的 due-content 必须含 userId + connectionId + connection.platformType
  // 三个字段才能装配 dispatcher input
  const makeContent = (
    id: string,
    title: string,
    platformType = "WECHAT_MP",
  ) => ({
    id,
    title,
    scheduledAt: new Date(),
    userId: `user-of-${id}`,
    connectionId: `conn-of-${id}`,
    connection: {
      id: `conn-of-${id}`,
      platformType,
    },
  });

  beforeEach(() => {
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();

    prisma = {
      socialContent: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    dispatcher = {
      tryReserveInFlight: jest.fn((_userId: string, contentId: string) => ({
        missionId: `social-mission-for-${contentId}`,
        reused: false,
      })),
      runMission: jest.fn().mockResolvedValue({
        missionId: "social-mission-x",
        status: "completed",
      }),
    };
    configService = { get: jest.fn((_k: string, def: unknown) => def) };

    service = new PublishSchedulerService(
      configService as never,
      prisma as never,
      dispatcher as never,
    );
  });

  describe("onModuleInit", () => {
    it("★ default-OFF: does NOT start scheduler when flag unset (anti silent-spend)", () => {
      // default mock returns the `def` arg → PUBLISH_SCHEDULER_ENABLED defaults false now
      const setIntSpy = jest.spyOn(global, "setInterval");
      service.onModuleInit();
      expect(setIntSpy).not.toHaveBeenCalled();
      setIntSpy.mockRestore();
    });

    it("starts scheduler when explicitly enabled (opt-in)", () => {
      configService.get.mockImplementation((key: string, def: unknown) =>
        key === "PUBLISH_SCHEDULER_ENABLED" ? true : def,
      );
      const setIntSpy = jest
        .spyOn(global, "setInterval")
        .mockReturnValue({ unref: jest.fn() } as never);
      const setTimSpy = jest
        .spyOn(global, "setTimeout")
        .mockReturnValue({ unref: jest.fn() } as never);

      service.onModuleInit();

      expect(setIntSpy).toHaveBeenCalled();
      expect(setTimSpy).toHaveBeenCalled();

      setIntSpy.mockRestore();
      setTimSpy.mockRestore();
    });

    it("skips scheduler when disabled", () => {
      configService.get.mockImplementation((key: string, def: unknown) =>
        key === "PUBLISH_SCHEDULER_ENABLED" ? false : def,
      );
      const setIntSpy = jest.spyOn(global, "setInterval");
      service.onModuleInit();
      expect(setIntSpy).not.toHaveBeenCalled();
      setIntSpy.mockRestore();
    });
  });

  describe("onModuleDestroy", () => {
    it("clears the interval if started", () => {
      const fakeInterval = setInterval(() => undefined, 999999);
      (service as unknown as { intervalId: NodeJS.Timeout }).intervalId =
        fakeInterval;
      service.onModuleDestroy();
      expect(
        (service as unknown as { intervalId: null }).intervalId,
      ).toBeNull();
      clearInterval(fakeInterval);
    });

    it("noop when no interval", () => {
      expect(() => service.onModuleDestroy()).not.toThrow();
    });
  });

  describe("processDuePublishes", () => {
    it("returns early when isRunning", async () => {
      (service as unknown as { isRunning: boolean }).isRunning = true;
      await service.processDuePublishes();
      expect(prisma.socialContent.findMany).not.toHaveBeenCalled();
    });

    it("returns early when no due content found", async () => {
      prisma.socialContent.findMany.mockResolvedValue([]);
      await service.processDuePublishes();
      expect(prisma.socialContent.updateMany).not.toHaveBeenCalled();
      expect(dispatcher.runMission).not.toHaveBeenCalled();
    });

    it("processes due contents: CAS update + dispatcher.runMission", async () => {
      prisma.socialContent.findMany.mockResolvedValue([
        makeContent("c1", "Post 1"),
        makeContent("c2", "Post 2", "XIAOHONGSHU"),
      ]);
      prisma.socialContent.updateMany.mockResolvedValue({ count: 1 });
      await service.processDuePublishes();

      expect(prisma.socialContent.updateMany).toHaveBeenCalledTimes(2);
      // Wait for fire-and-forget dispatcher calls to be registered
      await new Promise((r) => setImmediate(r));
      expect(dispatcher.runMission).toHaveBeenCalledTimes(2);
    });

    it("dispatches with depth=quick (fast-track pipeline)", async () => {
      prisma.socialContent.findMany.mockResolvedValue([
        makeContent("c1", "Post 1"),
      ]);
      await service.processDuePublishes();
      await new Promise((r) => setImmediate(r));

      expect(dispatcher.runMission).toHaveBeenCalledWith(
        "social-mission-for-c1",
        expect.objectContaining({
          contentId: "c1",
          depth: "quick",
          budgetProfile: "lean",
          platforms: ["WECHAT_MP"],
          connectionIds: { WECHAT_MP: "conn-of-c1" },
        }),
        "user-of-c1",
      );
    });

    it("passes platformType from connection (not hardcoded)", async () => {
      prisma.socialContent.findMany.mockResolvedValue([
        makeContent("xhs-1", "XHS Post", "XIAOHONGSHU"),
      ]);
      await service.processDuePublishes();
      await new Promise((r) => setImmediate(r));

      expect(dispatcher.runMission).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          platforms: ["XIAOHONGSHU"],
          connectionIds: { XIAOHONGSHU: "conn-of-xhs-1" },
        }),
        expect.any(String),
      );
    });

    it("skips content already picked up by another process (CAS miss)", async () => {
      prisma.socialContent.findMany.mockResolvedValue([
        makeContent("c1", "Post 1"),
      ]);
      prisma.socialContent.updateMany.mockResolvedValue({ count: 0 });
      await service.processDuePublishes();
      expect(dispatcher.runMission).not.toHaveBeenCalled();
    });

    it("logs warn + skip when connection record missing (defensive)", async () => {
      prisma.socialContent.findMany.mockResolvedValue([
        {
          id: "c-orphan",
          title: "Orphan",
          scheduledAt: new Date(),
          userId: "user-orphan",
          connectionId: "conn-x",
          connection: null,
        },
      ]);
      const warnSpy = jest.spyOn(Logger.prototype, "warn");
      await service.processDuePublishes();
      await new Promise((r) => setImmediate(r));
      expect(dispatcher.runMission).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("connection record missing"),
      );
    });

    it("logs error when single CAS update fails but continues", async () => {
      prisma.socialContent.findMany.mockResolvedValue([
        makeContent("c1", "Post 1"),
        makeContent("c2", "Post 2"),
      ]);
      prisma.socialContent.updateMany
        .mockRejectedValueOnce(new Error("write conflict"))
        .mockResolvedValueOnce({ count: 1 });
      await service.processDuePublishes();
      // first one threw and was caught, second one ran successfully
      await new Promise((r) => setImmediate(r));
      expect(dispatcher.runMission).toHaveBeenCalledTimes(1);
    });

    it("handles fire-and-forget dispatcher failure via .catch", async () => {
      prisma.socialContent.findMany.mockResolvedValue([
        makeContent("c1", "Post 1"),
      ]);
      dispatcher.runMission.mockRejectedValue(new Error("network down"));
      await service.processDuePublishes();
      await new Promise((r) => setImmediate(r));
      // No throw — error was caught in .catch handler
      expect(dispatcher.runMission).toHaveBeenCalled();
    });

    it("logs top-level error and clears isRunning", async () => {
      prisma.socialContent.findMany.mockRejectedValue(new Error("db down"));
      await service.processDuePublishes();
      expect((service as unknown as { isRunning: boolean }).isRunning).toBe(
        false,
      );
    });

    it("uses SocialContentStatus.SCHEDULED filter + selects connection.platformType", async () => {
      prisma.socialContent.findMany.mockResolvedValue([]);
      await service.processDuePublishes();
      expect(prisma.socialContent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: SocialContentStatus.SCHEDULED,
          }),
          select: expect.objectContaining({
            userId: true,
            connectionId: true,
            connection: expect.objectContaining({
              select: expect.objectContaining({
                platformType: true,
              }),
            }),
          }),
        }),
      );
    });
  });
});
