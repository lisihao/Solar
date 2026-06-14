import { Logger } from "@nestjs/common";
import { ResourceHealthCheckScheduler } from "../resource-health-check.scheduler";

const axiosMock = {
  default: {
    get: jest.fn(),
    head: jest.fn(),
  },
};
jest.mock("axios", () => axiosMock, { virtual: true });

describe("ResourceHealthCheckScheduler", () => {
  let scheduler: ResourceHealthCheckScheduler;
  let prisma: {
    resource: {
      findMany: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      count: jest.Mock;
    };
  };
  let configService: { get: jest.Mock };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();

    axiosMock.default.get.mockReset();
    axiosMock.default.head.mockReset();

    prisma = {
      resource: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    configService = {
      get: jest.fn((key: string, def: unknown) => def),
    };

    scheduler = new ResourceHealthCheckScheduler(
      configService as never,
      prisma as never,
    );
    // Bypass real sleep in batch loop so tests don't take 500ms each
    (scheduler as unknown as { sleep: () => Promise<void> }).sleep = () =>
      Promise.resolve();
  });

  describe("onModuleInit", () => {
    it("starts scheduler when RESOURCE_HEALTH_CHECK_ENABLED is explicitly true", () => {
      configService.get.mockImplementation((key: string, def: unknown) =>
        key === "RESOURCE_HEALTH_CHECK_ENABLED" ? true : def,
      );
      const setIntSpy = jest
        .spyOn(global, "setInterval")
        .mockReturnValue({ unref: jest.fn() } as never);
      const setTimSpy = jest
        .spyOn(global, "setTimeout")
        .mockReturnValue({ unref: jest.fn() } as never);

      scheduler.onModuleInit();

      expect(setIntSpy).toHaveBeenCalled();
      expect(setTimSpy).toHaveBeenCalled();

      setIntSpy.mockRestore();
      setTimSpy.mockRestore();
    });

    it("skips scheduler when RESOURCE_HEALTH_CHECK_ENABLED is false", () => {
      configService.get.mockImplementation((key: string, def: unknown) =>
        key === "RESOURCE_HEALTH_CHECK_ENABLED" ? false : def,
      );
      const setIntSpy = jest.spyOn(global, "setInterval");

      scheduler.onModuleInit();

      expect(setIntSpy).not.toHaveBeenCalled();

      setIntSpy.mockRestore();
    });

    it("default is ON — starts scheduler when RESOURCE_HEALTH_CHECK_ENABLED is not set", () => {
      // ConfigService returns the default value passed by the caller when the
      // env var is unset; that default is now `true`.
      configService.get.mockImplementation((_k: string, def: unknown) => def);
      const setIntSpy = jest
        .spyOn(global, "setInterval")
        .mockReturnValue({ unref: jest.fn() } as unknown as NodeJS.Timeout);
      const setTimSpy = jest
        .spyOn(global, "setTimeout")
        .mockReturnValue({ unref: jest.fn() } as unknown as NodeJS.Timeout);

      scheduler.onModuleInit();

      // default is true → scheduler must start
      expect(setIntSpy).toHaveBeenCalled();
      expect(setTimSpy).toHaveBeenCalled();

      setIntSpy.mockRestore();
      setTimSpy.mockRestore();
    });
  });

  describe("onModuleDestroy", () => {
    it("clears interval if started", () => {
      const fakeInterval = setInterval(() => undefined, 999999);
      (scheduler as unknown as { intervalId: NodeJS.Timeout }).intervalId =
        fakeInterval;

      scheduler.onModuleDestroy();

      expect(
        (scheduler as unknown as { intervalId: null }).intervalId,
      ).toBeNull();
      clearInterval(fakeInterval);
    });

    it("noop when no interval was set", () => {
      expect(() => scheduler.onModuleDestroy()).not.toThrow();
    });
  });

  describe("runHealthCheck", () => {
    it("skips when already running", async () => {
      (scheduler as unknown as { isRunning: boolean }).isRunning = true;

      await scheduler.runHealthCheck();

      expect(prisma.resource.findMany).not.toHaveBeenCalled();
    });

    it("returns early when no resources to check", async () => {
      prisma.resource.findMany.mockResolvedValue([]);

      await scheduler.runHealthCheck();

      // archiveStaleResources + newYoutube + 3 priority queries = 5 findMany calls
      expect(prisma.resource.findMany).toHaveBeenCalledTimes(5);
      expect(prisma.resource.update).not.toHaveBeenCalled();
    });

    it("processes UNKNOWN, stale HEALTHY, and BROKEN resources", async () => {
      prisma.resource.findMany
        .mockResolvedValueOnce([]) // archiveStaleResources query
        .mockResolvedValueOnce([]) // newYoutube 24h recheck query
        .mockResolvedValueOnce([
          {
            id: "u1",
            sourceUrl: "https://example.com/a",
            pdfUrl: null,
            linkHealth: "UNKNOWN",
            linkCheckFailCount: 0,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: "h1",
            sourceUrl: "https://example.com/b",
            pdfUrl: null,
            linkHealth: "HEALTHY",
            linkCheckFailCount: 0,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: "b1",
            sourceUrl: "https://example.com/c",
            pdfUrl: null,
            linkHealth: "BROKEN",
            linkCheckFailCount: 2,
          },
        ]);
      axiosMock.default.head.mockResolvedValue({ status: 200 });

      await scheduler.runHealthCheck();

      expect(prisma.resource.update).toHaveBeenCalledTimes(3);
    });

    it("logs error when run fails (e.g. archive query rejects)", async () => {
      prisma.resource.findMany.mockRejectedValueOnce(new Error("db down"));

      await scheduler.runHealthCheck();

      expect((scheduler as unknown as { isRunning: boolean }).isRunning).toBe(
        false,
      );
    });

    it("continues when single resource throws (does not break batch)", async () => {
      prisma.resource.findMany
        .mockResolvedValueOnce([]) // archive
        .mockResolvedValueOnce([]) // newYoutube
        .mockResolvedValueOnce([
          {
            id: "u1",
            sourceUrl: "https://example.com/a",
            pdfUrl: null,
            linkHealth: "UNKNOWN",
            linkCheckFailCount: 0,
          },
          {
            id: "u2",
            sourceUrl: "https://example.com/b",
            pdfUrl: null,
            linkHealth: "UNKNOWN",
            linkCheckFailCount: 0,
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      axiosMock.default.head
        .mockRejectedValueOnce(new Error("network"))
        .mockResolvedValueOnce({ status: 200 });
      axiosMock.default.get.mockRejectedValue(new Error("network"));
      // First one fails completely (HEAD fail then GET fail → returns false), update will succeed
      // Second one HEAD returns 200 → healthy

      await scheduler.runHealthCheck();

      expect(prisma.resource.update).toHaveBeenCalledTimes(2);
    });
  });

  describe("checkSingleResource (via runHealthCheck)", () => {
    it("returns early when neither sourceUrl nor pdfUrl", async () => {
      prisma.resource.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: "u1",
            sourceUrl: null,
            pdfUrl: null,
            linkHealth: "UNKNOWN",
            linkCheckFailCount: 0,
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      await scheduler.runHealthCheck();

      // No URLs to check → updateResourceHealth not invoked
      expect(prisma.resource.update).not.toHaveBeenCalled();
    });

    it("falls back to pdfUrl when sourceUrl unhealthy", async () => {
      prisma.resource.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: "u1",
            sourceUrl: "https://broken.test/a",
            pdfUrl: "https://example.com/a.pdf",
            linkHealth: "UNKNOWN",
            linkCheckFailCount: 0,
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      axiosMock.default.head
        .mockRejectedValueOnce(new Error("404"))
        .mockResolvedValueOnce({ status: 200 });
      axiosMock.default.get.mockRejectedValue(new Error("404"));

      await scheduler.runHealthCheck();

      expect(prisma.resource.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ linkHealth: "HEALTHY" }),
        }),
      );
    });
  });

  describe("checkUrlSmart / checkYoutubeUrl", () => {
    it("routes youtube.com URL to oEmbed (200 → healthy)", async () => {
      prisma.resource.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: "u1",
            sourceUrl: "https://www.youtube.com/watch?v=abc",
            pdfUrl: null,
            linkHealth: "UNKNOWN",
            linkCheckFailCount: 0,
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      axiosMock.default.get.mockResolvedValue({ status: 200 });

      await scheduler.runHealthCheck();

      expect(axiosMock.default.get).toHaveBeenCalledWith(
        expect.stringContaining("youtube.com/oembed"),
        expect.any(Object),
      );
      expect(prisma.resource.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ linkHealth: "HEALTHY" }),
        }),
      );
    });

    it("youtube oEmbed 404 → broken progression", async () => {
      prisma.resource.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: "u1",
            sourceUrl: "https://youtu.be/xyz",
            pdfUrl: null,
            linkHealth: "BROKEN",
            linkCheckFailCount: 2,
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      axiosMock.default.get.mockResolvedValue({ status: 404 });

      await scheduler.runHealthCheck();

      // failCount reached threshold (2+1=3) → BROKEN
      expect(prisma.resource.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            linkHealth: "BROKEN",
            linkCheckFailCount: 3,
          }),
        }),
      );
    });

    it("youtube oEmbed 401 → broken on first failure (YouTube fast threshold)", async () => {
      prisma.resource.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: "u1",
            sourceUrl: "https://m.youtube.com/watch?v=abc",
            pdfUrl: null,
            linkHealth: "UNKNOWN",
            linkCheckFailCount: 0,
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      axiosMock.default.get.mockResolvedValue({ status: 401 });

      await scheduler.runHealthCheck();

      // YouTube uses YOUTUBE_FAIL_THRESHOLD=1: 0+1=1 ≥ 1 → BROKEN immediately.
      // 401/404 是 YouTube 删除/私有的确定信号，无需 3 次冗余确认
      expect(prisma.resource.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            linkCheckFailCount: 1,
            linkHealth: "BROKEN",
          }),
        }),
      );
    });

    it("youtube oEmbed 429 → ambiguous, treated as healthy", async () => {
      prisma.resource.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: "u1",
            sourceUrl: "https://youtube.com/watch?v=abc",
            pdfUrl: null,
            linkHealth: "UNKNOWN",
            linkCheckFailCount: 0,
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      axiosMock.default.get.mockResolvedValue({ status: 429 });

      await scheduler.runHealthCheck();

      expect(prisma.resource.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ linkHealth: "HEALTHY" }),
        }),
      );
    });

    it("youtube oEmbed network error → treated as healthy (保守)", async () => {
      prisma.resource.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: "u1",
            sourceUrl: "https://www.youtube.com/watch?v=abc",
            pdfUrl: null,
            linkHealth: "UNKNOWN",
            linkCheckFailCount: 0,
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      axiosMock.default.get.mockRejectedValue(new Error("ETIMEDOUT"));

      await scheduler.runHealthCheck();

      expect(prisma.resource.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ linkHealth: "HEALTHY" }),
        }),
      );
    });

    it("invalid URL falls through to HEAD check (still attempts)", async () => {
      prisma.resource.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: "u1",
            sourceUrl: "not-a-valid-url",
            pdfUrl: null,
            linkHealth: "UNKNOWN",
            linkCheckFailCount: 0,
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      axiosMock.default.head.mockRejectedValue(new Error("invalid"));
      axiosMock.default.get.mockRejectedValue(new Error("invalid"));

      await scheduler.runHealthCheck();

      // not healthy → failCount++
      expect(prisma.resource.update).toHaveBeenCalled();
    });
  });

  describe("checkUrl HEAD/GET fallback", () => {
    it("uses HEAD when it returns < 400", async () => {
      prisma.resource.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: "u1",
            sourceUrl: "https://example.com/a",
            pdfUrl: null,
            linkHealth: "UNKNOWN",
            linkCheckFailCount: 0,
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      axiosMock.default.head.mockResolvedValue({ status: 200 });

      await scheduler.runHealthCheck();

      expect(prisma.resource.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ linkHealth: "HEALTHY" }),
        }),
      );
    });

    it("falls back to GET Range when HEAD fails", async () => {
      prisma.resource.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: "u1",
            sourceUrl: "https://example.com/a",
            pdfUrl: null,
            linkHealth: "UNKNOWN",
            linkCheckFailCount: 0,
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      axiosMock.default.head.mockRejectedValue(
        new Error("405 Method Not Allowed"),
      );
      axiosMock.default.get.mockResolvedValue({ status: 206 });

      await scheduler.runHealthCheck();

      expect(prisma.resource.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ linkHealth: "HEALTHY" }),
        }),
      );
    });

    it("returns false when both HEAD and GET fail", async () => {
      prisma.resource.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: "u1",
            sourceUrl: "https://nope.test/a",
            pdfUrl: null,
            linkHealth: "UNKNOWN",
            linkCheckFailCount: 0,
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      axiosMock.default.head.mockRejectedValue(new Error("DNS"));
      axiosMock.default.get.mockRejectedValue(new Error("DNS"));

      await scheduler.runHealthCheck();

      expect(prisma.resource.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ linkCheckFailCount: 1 }),
        }),
      );
    });
  });

  describe("updateResourceHealth", () => {
    it("logs recovery when BROKEN → HEALTHY", async () => {
      prisma.resource.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: "b1",
            sourceUrl: "https://recovered.test/a",
            pdfUrl: null,
            linkHealth: "BROKEN",
            linkCheckFailCount: 3,
          },
        ]);
      axiosMock.default.head.mockResolvedValue({ status: 200 });
      const logSpy = jest.spyOn(scheduler["logger"], "log");

      await scheduler.runHealthCheck();

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("recovered"));
    });

    it("warns when transitioning to BROKEN at threshold", async () => {
      prisma.resource.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: "h1",
            sourceUrl: "https://going-bad.test/a",
            pdfUrl: null,
            linkHealth: "HEALTHY",
            linkCheckFailCount: 2,
          },
        ])
        .mockResolvedValueOnce([]);
      axiosMock.default.head.mockRejectedValue(new Error("404"));
      axiosMock.default.get.mockRejectedValue(new Error("404"));
      const warnSpy = jest.spyOn(scheduler["logger"], "warn");

      await scheduler.runHealthCheck();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("marked BROKEN"),
      );
    });

    it("does not log recovery when HEALTHY stays HEALTHY", async () => {
      prisma.resource.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: "h1",
            sourceUrl: "https://still-healthy.test/a",
            pdfUrl: null,
            linkHealth: "HEALTHY",
            linkCheckFailCount: 0,
          },
        ])
        .mockResolvedValueOnce([]);
      axiosMock.default.head.mockResolvedValue({ status: 200 });

      await scheduler.runHealthCheck();

      expect(prisma.resource.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ linkCheckFailCount: 0 }),
        }),
      );
    });

    it("uses UNKNOWN fallback when linkHealth is null", async () => {
      prisma.resource.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: "u1",
            sourceUrl: "https://nope.test/a",
            pdfUrl: null,
            linkHealth: null,
            linkCheckFailCount: 0,
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      axiosMock.default.head.mockRejectedValue(new Error("nope"));
      axiosMock.default.get.mockRejectedValue(new Error("nope"));

      await scheduler.runHealthCheck();

      expect(prisma.resource.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ linkHealth: "UNKNOWN" }),
        }),
      );
    });
  });

  describe("archiveStaleResources", () => {
    it("archives BROKEN resources older than 30 days with no notes/comments", async () => {
      prisma.resource.findMany
        .mockResolvedValueOnce([{ id: "s1" }, { id: "s2" }]) // archive query
        .mockResolvedValue([]); // priority queries

      await scheduler.runHealthCheck();

      expect(prisma.resource.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ["s1", "s2"] } },
        data: { linkHealth: "ARCHIVED" },
      });
    });

    it("does nothing when no stale resources", async () => {
      prisma.resource.findMany.mockResolvedValue([]);

      await scheduler.runHealthCheck();

      expect(prisma.resource.updateMany).not.toHaveBeenCalled();
    });
  });

  describe("scanAndMarkBroken", () => {
    it("returns zero counts when no candidates", async () => {
      prisma.resource.findMany.mockResolvedValue([]); // unknown + stale both empty

      const result = await scheduler.scanAndMarkBroken();

      expect(result).toEqual({ scanned: 0, broken: 0, capped: false });
      expect(prisma.resource.count).not.toHaveBeenCalled();
    });

    it("skips when a health check is already running", async () => {
      (scheduler as unknown as { isRunning: boolean }).isRunning = true;

      const result = await scheduler.scanAndMarkBroken();

      expect(result).toEqual({ scanned: 0, broken: 0, capped: false });
      expect(prisma.resource.findMany).not.toHaveBeenCalled();
    });

    it("probes candidates, marks broken, and reports counts", async () => {
      prisma.resource.findMany
        .mockResolvedValueOnce([
          {
            id: "u1",
            sourceUrl: "https://youtu.be/dead",
            pdfUrl: null,
            linkHealth: "UNKNOWN",
            linkCheckFailCount: 0,
            title: "t",
            type: "YOUTUBE_VIDEO",
          },
        ]) // UNKNOWN candidates
        .mockResolvedValueOnce([]); // stale HEALTHY candidates
      // YouTube oEmbed 404 → deleted → broken (threshold 1)
      axiosMock.default.get.mockResolvedValue({ status: 404 });
      prisma.resource.count.mockResolvedValue(1);

      const result = await scheduler.scanAndMarkBroken();

      expect(prisma.resource.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ linkHealth: "BROKEN" }),
        }),
      );
      expect(prisma.resource.count).toHaveBeenCalledWith({
        where: { id: { in: ["u1"] }, linkHealth: "BROKEN" },
      });
      expect(result).toEqual({ scanned: 1, broken: 1, capped: false });
      // 必须重置 isRunning，否则后续定时检查会被永久跳过
      expect((scheduler as unknown as { isRunning: boolean }).isRunning).toBe(
        false,
      );
    });
  });
});
