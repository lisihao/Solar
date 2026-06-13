import { BadRequestException, NotFoundException } from "@nestjs/common";
import { SocialContentTaskStatus } from "@prisma/client";
import { SocialTaskService } from "../social-task.service";
import type { CreateSocialTaskDto } from "../../api/dto/create-social-task.dto";
import type {
  ContentSource,
  SourceContentBundle,
} from "../../../../contracts/social-data-source";

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeBundle(
  overrides: Partial<SourceContentBundle> = {},
): SourceContentBundle {
  return {
    sourceType: "ai-research",
    sourceId: "src-1",
    title: "Test Title",
    body: "Test body content",
    bodyMime: "text/markdown",
    sourceMetadata: {},
    displayMetadata: {},
    ...overrides,
  };
}

function makeSource(id: string, bundles: SourceContentBundle[]): ContentSource {
  return {
    id,
    displayName: { "zh-CN": "测试", "en-US": "Test" },
    icon: "test",
    description: { "zh-CN": "描述", "en-US": "Desc" },
    contentKinds: ["article"],
    listItems: jest.fn().mockResolvedValue({ items: [] }),
    fetchBundle: jest.fn().mockResolvedValue(bundles),
  };
}

function makePrisma() {
  return {
    socialContentTask: {
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    socialContentTaskVersion: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    // 2026-05-19: dispatchTask 现在会先 create 占位 SocialContent 行（FK 满足）
    socialContent: {
      create: jest.fn().mockResolvedValue({ id: "placeholder-content-id" }),
    },
  };
}

function makeRegistry(sources: ContentSource[] = []) {
  return {
    get: jest.fn((id: string) => sources.find((s) => s.id === id)),
    list: jest.fn(() => sources),
    listDescriptors: jest.fn(() => []),
  };
}

function makeContentFetcher() {
  return {
    fetchFromUrl: jest.fn().mockResolvedValue({
      title: "External Title",
      content: "External body",
    }),
  };
}

function makeDispatcher() {
  return {
    tryReserveInFlight: jest
      .fn()
      .mockReturnValue({ missionId: "mission-abc", reused: false }),
    runMission: jest
      .fn()
      .mockResolvedValue({ missionId: "mission-abc", status: "completed" }),
  };
}

function makeDto(
  overrides: Partial<CreateSocialTaskDto> = {},
): CreateSocialTaskDto {
  return {
    sources: [{ sourceType: "ai-research", sourceId: "src-1" }],
    platforms: ["WECHAT_MP"],
    accountIds: { WECHAT_MP: "conn-1" },
    ...overrides,
  } as CreateSocialTaskDto;
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe("SocialTaskService", () => {
  describe("createTask()", () => {
    it("creates task row and returns id on valid input", async () => {
      const prisma = makePrisma();
      const registry = makeRegistry([
        makeSource("ai-research", [makeBundle()]),
      ]);
      const fetcher = makeContentFetcher();
      const dispatcher = makeDispatcher();

      prisma.socialContentTask.create.mockResolvedValue({ id: "task-1" });
      prisma.socialContentTask.update.mockResolvedValue({});

      const svc = new SocialTaskService(
        prisma as never,
        registry as never,
        fetcher as never,
        dispatcher as never,
      );

      const result = await svc.createTask(makeDto(), "user-1");

      expect(result).toEqual({ id: "task-1" });
      expect(prisma.socialContentTask.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: "user-1",
            status: SocialContentTaskStatus.PENDING,
          }),
        }),
      );
    });

    it("fires dispatch as fire-and-forget (non-blocking)", async () => {
      const prisma = makePrisma();
      const registry = makeRegistry([
        makeSource("ai-research", [makeBundle()]),
      ]);
      const fetcher = makeContentFetcher();
      const dispatcher = makeDispatcher();

      prisma.socialContentTask.create.mockResolvedValue({ id: "task-ff" });
      prisma.socialContentTask.update.mockResolvedValue({});

      // Make runMission never resolve to verify fire-and-forget
      let resolveRun!: () => void;
      dispatcher.runMission.mockReturnValue(
        new Promise((r) => {
          resolveRun = () => r({ missionId: "x", status: "completed" });
        }),
      );

      const svc = new SocialTaskService(
        prisma as never,
        registry as never,
        fetcher as never,
        dispatcher as never,
      );
      const result = await svc.createTask(makeDto(), "user-1");

      // createTask returned immediately even though runMission is still pending
      expect(result).toEqual({ id: "task-ff" });

      // cleanup
      resolveRun();
    });

    it("throws BadRequest when sources and externalUrls are both empty", async () => {
      const svc = new SocialTaskService(
        makePrisma() as never,
        makeRegistry() as never,
        makeContentFetcher() as never,
        makeDispatcher() as never,
      );

      await expect(
        svc.createTask(makeDto({ sources: [], externalUrls: [] }), "user-1"),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequest when platform has no accountId", async () => {
      const svc = new SocialTaskService(
        makePrisma() as never,
        makeRegistry() as never,
        makeContentFetcher() as never,
        makeDispatcher() as never,
      );

      await expect(
        svc.createTask(
          makeDto({
            platforms: ["WECHAT_MP", "XIAOHONGSHU"],
            accountIds: { WECHAT_MP: "conn-1" },
          }),
          "user-1",
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("aggregateContent() via dispatchTask", () => {
    it("combines multiple bundles from different sources", async () => {
      const src1 = makeSource("ai-research", [
        makeBundle({
          title: "A",
          body: "Body A",
          sourceType: "ai-research",
          sourceId: "id-1",
        }),
      ]);
      const src2 = makeSource("ai-office", [
        makeBundle({
          title: "B",
          body: "Body B",
          sourceType: "ai-office",
          sourceId: "id-2",
        }),
      ]);
      const prisma = makePrisma();
      const registry = makeRegistry([src1, src2]);
      const fetcher = makeContentFetcher();
      const dispatcher = makeDispatcher();

      prisma.socialContentTask.create.mockResolvedValue({ id: "task-multi" });
      prisma.socialContentTask.update.mockResolvedValue({});

      const svc = new SocialTaskService(
        prisma as never,
        registry as never,
        fetcher as never,
        dispatcher as never,
      );
      await svc.createTask(
        makeDto({
          sources: [
            { sourceType: "ai-research", sourceId: "id-1" },
            { sourceType: "ai-office", sourceId: "id-2" },
          ],
          platforms: ["WECHAT_MP"],
          accountIds: { WECHAT_MP: "conn-1" },
        }),
        "user-1",
      );

      // Wait a tick for the fire-and-forget to run
      await new Promise((r) => setImmediate(r));

      expect(dispatcher.runMission).toHaveBeenCalledWith(
        "mission-abc",
        expect.anything(),
        "user-1",
        undefined,
        expect.objectContaining({ body: expect.stringContaining("Body A") }),
      );
      const call = dispatcher.runMission.mock.calls[0];
      const bag = call[4];
      expect(bag.body).toContain("Body B");
    });

    it("is fault-tolerant: partial source failure uses successful ones", async () => {
      const goodSrc = makeSource("ai-research", [
        makeBundle({ title: "Good", body: "Good body" }),
      ]);
      const badSrc = makeSource("ai-office", []);
      (badSrc.fetchBundle as jest.Mock).mockRejectedValue(
        new Error("source error"),
      );

      const prisma = makePrisma();
      const registry = makeRegistry([goodSrc, badSrc]);
      const fetcher = makeContentFetcher();
      const dispatcher = makeDispatcher();

      prisma.socialContentTask.create.mockResolvedValue({ id: "task-partial" });
      prisma.socialContentTask.update.mockResolvedValue({});

      const svc = new SocialTaskService(
        prisma as never,
        registry as never,
        fetcher as never,
        dispatcher as never,
      );
      await svc.createTask(
        makeDto({
          sources: [
            { sourceType: "ai-research", sourceId: "id-1" },
            { sourceType: "ai-office", sourceId: "id-2" },
          ],
        }),
        "user-1",
      );

      await new Promise((r) => setImmediate(r));

      // Mission was still dispatched with content from the good source
      expect(dispatcher.runMission).toHaveBeenCalledWith(
        expect.any(String),
        expect.anything(),
        "user-1",
        undefined,
        expect.objectContaining({ body: expect.stringContaining("Good body") }),
      );
    });

    it("marks task FAILED when all sources and URLs fail", async () => {
      const badSrc = makeSource("ai-research", []);
      (badSrc.fetchBundle as jest.Mock).mockRejectedValue(new Error("gone"));

      const prisma = makePrisma();
      const registry = makeRegistry([badSrc]);
      const fetcher = makeContentFetcher();
      fetcher.fetchFromUrl.mockRejectedValue(new Error("url fail"));
      const dispatcher = makeDispatcher();

      prisma.socialContentTask.create.mockResolvedValue({
        id: "task-all-fail",
      });
      prisma.socialContentTask.update.mockResolvedValue({});

      const svc = new SocialTaskService(
        prisma as never,
        registry as never,
        fetcher as never,
        dispatcher as never,
      );
      await svc.createTask(
        makeDto({
          sources: [{ sourceType: "ai-research", sourceId: "id-1" }],
          externalUrls: ["https://example.com"],
        }),
        "user-1",
      );

      await new Promise((r) => setImmediate(r));

      expect(prisma.socialContentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: SocialContentTaskStatus.FAILED,
          }),
        }),
      );
    });

    it("fetches externalUrls through ContentFetcherService (not direct fetch)", async () => {
      const prisma = makePrisma();
      const registry = makeRegistry([]);
      const fetcher = makeContentFetcher();
      const dispatcher = makeDispatcher();

      prisma.socialContentTask.create.mockResolvedValue({ id: "task-url" });
      prisma.socialContentTask.update.mockResolvedValue({});

      const svc = new SocialTaskService(
        prisma as never,
        registry as never,
        fetcher as never,
        dispatcher as never,
      );
      await svc.createTask(
        makeDto({ sources: [], externalUrls: ["https://example.com/article"] }),
        "user-1",
      );

      await new Promise((r) => setImmediate(r));

      expect(fetcher.fetchFromUrl).toHaveBeenCalledWith(
        "https://example.com/article",
      );
      // Verify no direct global fetch was called (we rely on the service mock)
    });
  });

  describe("dispatchTask()", () => {
    it("sets status DRAFT_READY when runMission returns completed", async () => {
      const src = makeSource("ai-research", [makeBundle()]);
      const prisma = makePrisma();
      const registry = makeRegistry([src]);
      const fetcher = makeContentFetcher();
      const dispatcher = makeDispatcher();
      dispatcher.runMission.mockResolvedValue({
        missionId: "mission-1",
        status: "completed",
      });

      prisma.socialContentTask.create.mockResolvedValue({ id: "task-done" });
      prisma.socialContentTask.update.mockResolvedValue({});

      const svc = new SocialTaskService(
        prisma as never,
        registry as never,
        fetcher as never,
        dispatcher as never,
      );
      await svc.createTask(makeDto(), "user-1");
      await new Promise((r) => setImmediate(r));

      const updateCalls = prisma.socialContentTask.update.mock.calls;
      const finalUpdate = updateCalls.find(
        (c) => c[0].data.status === SocialContentTaskStatus.DRAFT_READY,
      );
      expect(finalUpdate).toBeDefined();
    });

    it("sets status FAILED when runMission returns failed", async () => {
      const src = makeSource("ai-research", [makeBundle()]);
      const prisma = makePrisma();
      const registry = makeRegistry([src]);
      const fetcher = makeContentFetcher();
      const dispatcher = makeDispatcher();
      dispatcher.runMission.mockResolvedValue({
        missionId: "m",
        status: "failed",
        error: new Error("pipeline error"),
      });

      prisma.socialContentTask.create.mockResolvedValue({ id: "task-fail" });
      prisma.socialContentTask.update.mockResolvedValue({});

      const svc = new SocialTaskService(
        prisma as never,
        registry as never,
        fetcher as never,
        dispatcher as never,
      );
      await svc.createTask(makeDto(), "user-1");
      await new Promise((r) => setImmediate(r));

      const updateCalls = prisma.socialContentTask.update.mock.calls;
      const failUpdate = updateCalls.find(
        (c) => c[0].data?.status === SocialContentTaskStatus.FAILED,
      );
      expect(failUpdate).toBeDefined();
      expect(failUpdate[0].data.errorMessage).toContain("pipeline error");
    });

    // ★ R3 P1-2 / R4 P1 fix (2026-05-18): PARTIAL_PUBLISHED aggregation
    it("recomputes status PARTIAL_PUBLISHED when versions mix PUBLISHED + FAILED", async () => {
      const src = makeSource("ai-research", [makeBundle()]);
      const prisma = makePrisma();
      const registry = makeRegistry([src]);
      const fetcher = makeContentFetcher();
      const dispatcher = makeDispatcher();
      prisma.socialContentTask.create.mockResolvedValue({ id: "task-partial" });
      prisma.socialContentTask.update.mockResolvedValue({});
      prisma.socialContentTaskVersion.findMany.mockResolvedValue([
        { status: "PUBLISHED" },
        { status: "FAILED" },
      ]);

      const svc = new SocialTaskService(
        prisma as never,
        registry as never,
        fetcher as never,
        dispatcher as never,
      );
      await svc.createTask(makeDto(), "user-1");
      await new Promise((r) => setImmediate(r));

      const finalUpdate = prisma.socialContentTask.update.mock.calls.find(
        (c) => c[0].data.status === SocialContentTaskStatus.PARTIAL_PUBLISHED,
      );
      expect(finalUpdate).toBeDefined();
    });

    it("recomputes status PUBLISHED when all versions are PUBLISHED", async () => {
      const src = makeSource("ai-research", [makeBundle()]);
      const prisma = makePrisma();
      prisma.socialContentTask.create.mockResolvedValue({ id: "task-pub" });
      prisma.socialContentTask.update.mockResolvedValue({});
      prisma.socialContentTaskVersion.findMany.mockResolvedValue([
        { status: "PUBLISHED" },
        { status: "PUBLISHED" },
      ]);

      const svc = new SocialTaskService(
        prisma as never,
        makeRegistry([src]) as never,
        makeContentFetcher() as never,
        makeDispatcher() as never,
      );
      await svc.createTask(
        makeDto({
          platforms: ["WECHAT_MP", "XIAOHONGSHU"],
          accountIds: { WECHAT_MP: "c1", XIAOHONGSHU: "c2" },
        }),
        "user-1",
      );
      await new Promise((r) => setImmediate(r));

      const finalUpdate = prisma.socialContentTask.update.mock.calls.find(
        (c) => c[0].data.status === SocialContentTaskStatus.PUBLISHED,
      );
      expect(finalUpdate).toBeDefined();
    });

    it("catches thrown errors and marks task FAILED", async () => {
      const src = makeSource("ai-research", [makeBundle()]);
      const prisma = makePrisma();
      const registry = makeRegistry([src]);
      const fetcher = makeContentFetcher();
      const dispatcher = makeDispatcher();
      dispatcher.runMission.mockRejectedValue(new Error("unexpected crash"));

      prisma.socialContentTask.create.mockResolvedValue({ id: "task-crash" });
      prisma.socialContentTask.update.mockResolvedValue({});

      const svc = new SocialTaskService(
        prisma as never,
        registry as never,
        fetcher as never,
        dispatcher as never,
      );
      await svc.createTask(makeDto(), "user-1");
      await new Promise((r) => setImmediate(r));

      const updateCalls = prisma.socialContentTask.update.mock.calls;
      const failUpdate = updateCalls.find(
        (c) => c[0].data?.status === SocialContentTaskStatus.FAILED,
      );
      expect(failUpdate).toBeDefined();
    });
  });

  describe("listTasks()", () => {
    it("enforces userId isolation", async () => {
      const prisma = makePrisma();
      prisma.socialContentTask.findMany.mockResolvedValue([]);

      const svc = new SocialTaskService(
        prisma as never,
        makeRegistry() as never,
        makeContentFetcher() as never,
        makeDispatcher() as never,
      );

      await svc.listTasks("target-user", {});

      expect(prisma.socialContentTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: "target-user" }),
        }),
      );
    });

    it("returns nextCursor when there are more items", async () => {
      const prisma = makePrisma();
      const date = new Date("2026-01-01T00:00:00Z");
      const items = Array.from({ length: 21 }, (_, i) => ({
        id: `t-${i}`,
        createdAt: new Date(date.getTime() - i * 1000),
        sources: [],
        versions: [],
      }));
      prisma.socialContentTask.findMany.mockResolvedValue(items);

      const svc = new SocialTaskService(
        prisma as never,
        makeRegistry() as never,
        makeContentFetcher() as never,
        makeDispatcher() as never,
      );

      const result = await svc.listTasks("user-1", { limit: 20 });
      expect(result.items).toHaveLength(20);
      expect(result.nextCursor).toBeDefined();
    });
  });

  describe("getTask()", () => {
    it("throws NotFoundException for another user task", async () => {
      const prisma = makePrisma();
      prisma.socialContentTask.findFirst.mockResolvedValue(null);

      const svc = new SocialTaskService(
        prisma as never,
        makeRegistry() as never,
        makeContentFetcher() as never,
        makeDispatcher() as never,
      );

      await expect(svc.getTask("task-99", "other-user")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("cancelTask()", () => {
    it("hard-deletes a PUBLISHED task (terminal state, returns mode=deleted)", async () => {
      const prisma = makePrisma();
      prisma.socialContentTask.findFirst.mockResolvedValue({
        id: "task-pub",
        status: SocialContentTaskStatus.PUBLISHED,
      });
      // need to mock delete since cancelTask now calls it for terminal states
      (prisma.socialContentTask as unknown as { delete: jest.Mock }).delete =
        jest.fn().mockResolvedValue({});

      const svc = new SocialTaskService(
        prisma as never,
        makeRegistry() as never,
        makeContentFetcher() as never,
        makeDispatcher() as never,
      );

      const result = await svc.cancelTask("task-pub", "user-1");
      expect(result).toEqual({ mode: "deleted" });
      expect(
        (prisma.socialContentTask as unknown as { delete: jest.Mock }).delete,
      ).toHaveBeenCalledWith({ where: { id: "task-pub" } });
    });

    it("cancels a PENDING task successfully", async () => {
      const prisma = makePrisma();
      prisma.socialContentTask.findFirst.mockResolvedValue({
        id: "task-pend",
        status: SocialContentTaskStatus.PENDING,
      });
      prisma.socialContentTask.update.mockResolvedValue({});

      const svc = new SocialTaskService(
        prisma as never,
        makeRegistry() as never,
        makeContentFetcher() as never,
        makeDispatcher() as never,
      );

      await svc.cancelTask("task-pend", "user-1");

      expect(prisma.socialContentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: SocialContentTaskStatus.CANCELLED },
        }),
      );
    });

    it("cancels a GENERATING task successfully", async () => {
      const prisma = makePrisma();
      prisma.socialContentTask.findFirst.mockResolvedValue({
        id: "task-gen",
        status: SocialContentTaskStatus.GENERATING,
      });
      prisma.socialContentTask.update.mockResolvedValue({});

      const svc = new SocialTaskService(
        prisma as never,
        makeRegistry() as never,
        makeContentFetcher() as never,
        makeDispatcher() as never,
      );

      await svc.cancelTask("task-gen", "user-1");

      expect(prisma.socialContentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: SocialContentTaskStatus.CANCELLED },
        }),
      );
    });
  });
});
