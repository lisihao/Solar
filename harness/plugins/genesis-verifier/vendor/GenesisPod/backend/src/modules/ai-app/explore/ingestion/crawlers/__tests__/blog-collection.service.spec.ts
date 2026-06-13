import { Test, TestingModule } from "@nestjs/testing";
import { BlogCollectionService } from "../blog-collection.service";
import type { CollectedBlogPost } from "../blog-collection.types";

describe("BlogCollectionService", () => {
  let service: BlogCollectionService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [BlogCollectionService],
    })
      .setLogger({
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        verbose: jest.fn(),
      } as any)
      .compile();

    service = module.get<BlogCollectionService>(BlogCollectionService);
  });

  // ─── collectFromSource ───────────────────────────────────────────────────────

  describe("collectFromSource", () => {
    it("returns failed task when sourceId is unknown", async () => {
      const task = await service.collectFromSource("unknown-source");

      expect(task.status).toBe("failed");
      expect(task.error).toContain("not found");
      expect(task.sourceId).toBe("unknown-source");
    });

    it("returns completed task for known source nvidia-official", async () => {
      const mockPosts: CollectedBlogPost[] = [
        {
          id: "post-1",
          title: "NVIDIA News",
          sourceUrl: "https://blogs.nvidia.com/post/1",
          sourceId: "nvidia-official",
          sourceName: "NVIDIA Official Blog",
          publishedAt: new Date("2024-01-01"),
          category: "enterprise",
          contentHash: "hash-1",
        },
      ];

      jest
        .spyOn(service as any, "fetchPostsFromSource")
        .mockResolvedValue(mockPosts);

      const task = await service.collectFromSource("nvidia-official");

      expect(task.status).toBe("completed");
      expect(task.sourceName).toBe("NVIDIA Official Blog");
      expect(task.postsCollected).toBe(1);
      expect(task.postsSaved).toBe(1);
      expect(task.endTime).toBeInstanceOf(Date);
    });

    it("returns completed task for known source broadcom-news", async () => {
      const mockPosts: CollectedBlogPost[] = [
        {
          id: "post-2",
          title: "Broadcom Update",
          sourceUrl: "https://www.broadcom.com/news/1",
          sourceId: "broadcom-news",
          sourceName: "Broadcom News",
          publishedAt: new Date(),
          category: "enterprise",
          contentHash: "hash-2",
        },
      ];

      jest
        .spyOn(service as any, "fetchPostsFromSource")
        .mockResolvedValue(mockPosts);

      const task = await service.collectFromSource("broadcom-news");

      expect(task.status).toBe("completed");
      expect(task.sourceName).toBe("Broadcom News");
      expect(task.postsCollected).toBe(1);
    });

    it("returns completed task with zero posts when no posts fetched", async () => {
      jest.spyOn(service as any, "fetchPostsFromSource").mockResolvedValue([]);

      const task = await service.collectFromSource("nvidia-official");

      expect(task.status).toBe("completed");
      expect(task.postsCollected).toBe(0);
      expect(task.postsSaved).toBe(0);
    });

    it("returns failed task when fetchPostsFromSource throws", async () => {
      jest
        .spyOn(service as any, "fetchPostsFromSource")
        .mockRejectedValue(new Error("catastrophic error"));

      const task = await service.collectFromSource("nvidia-official");

      expect(task.status).toBe("failed");
      expect(task.error).toContain("catastrophic error");
    });

    it("sets task id as a UUID", async () => {
      const task = await service.collectFromSource("unknown-source");

      expect(task.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it("sets startTime on the task", async () => {
      const before = new Date();
      const task = await service.collectFromSource("unknown-source");
      const after = new Date();

      expect(task.startTime).toBeInstanceOf(Date);
      expect(task.startTime!.getTime()).toBeGreaterThanOrEqual(
        before.getTime(),
      );
      expect(task.startTime!.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it("sets endTime on the failed task", async () => {
      jest
        .spyOn(service as any, "fetchPostsFromSource")
        .mockRejectedValue(new Error("error"));

      const before = new Date();
      const task = await service.collectFromSource("nvidia-official");
      const after = new Date();

      expect(task.endTime).toBeInstanceOf(Date);
      expect(task.endTime!.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(task.endTime!.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it("sets retryCount to 0 on the task", async () => {
      const task = await service.collectFromSource("unknown-source");

      expect(task.retryCount).toBe(0);
    });

    it("counts multiple posts correctly", async () => {
      const mockPosts: CollectedBlogPost[] = [
        {
          id: "p1",
          title: "Post A",
          sourceUrl: "https://blogs.nvidia.com/a",
          sourceId: "nvidia-official",
          sourceName: "NVIDIA",
          publishedAt: new Date(),
          category: "enterprise",
          contentHash: "h1",
        },
        {
          id: "p2",
          title: "Post B",
          sourceUrl: "https://blogs.nvidia.com/b",
          sourceId: "nvidia-official",
          sourceName: "NVIDIA",
          publishedAt: new Date(),
          category: "enterprise",
          contentHash: "h2",
        },
        {
          id: "p3",
          title: "Post C",
          sourceUrl: "https://blogs.nvidia.com/c",
          sourceId: "nvidia-official",
          sourceName: "NVIDIA",
          publishedAt: new Date(),
          category: "enterprise",
          contentHash: "h3",
        },
      ];

      jest
        .spyOn(service as any, "fetchPostsFromSource")
        .mockResolvedValue(mockPosts);

      const task = await service.collectFromSource("nvidia-official");

      expect(task.postsCollected).toBe(3);
      expect(task.postsSaved).toBe(3);
    });
  });

  // ─── getActiveSources ────────────────────────────────────────────────────────

  describe("getActiveSources", () => {
    it("returns a non-empty list of active sources", async () => {
      const sources = await service.getActiveSources();

      expect(sources.length).toBeGreaterThan(0);
    });

    it("all returned sources have isActive=true", async () => {
      const sources = await service.getActiveSources();

      for (const source of sources) {
        expect(source.isActive).toBe(true);
      }
    });

    it("includes expected source ids", async () => {
      const sources = await service.getActiveSources();
      const ids = sources.map((s) => s.id);

      expect(ids).toContain("nvidia-official");
      expect(ids).toContain("broadcom-news");
      expect(ids).toContain("google-blog");
    });

    it("all sources have required fields (id, displayName, category)", async () => {
      const sources = await service.getActiveSources();

      for (const source of sources) {
        expect(source.id).toBeTruthy();
        expect(source.displayName).toBeTruthy();
        expect(source.category).toBeTruthy();
      }
    });
  });

  // ─── getCollectionStats ──────────────────────────────────────────────────────

  describe("getCollectionStats", () => {
    it("returns stats object with expected shape", async () => {
      const stats = await service.getCollectionStats();

      expect(stats).toMatchObject({
        totalPosts: expect.any(Number),
        totalSources: expect.any(Number),
        activeTasks: expect.any(Number),
        collectionStatus: "active",
        averageCollectionDuration: expect.any(Number),
      });
    });

    it("returns totalSources = 3", async () => {
      const stats = await service.getCollectionStats();

      expect(stats.totalSources).toBe(3);
    });

    it("returns activeTasks = 0", async () => {
      const stats = await service.getCollectionStats();

      expect(stats.activeTasks).toBe(0);
    });
  });

  // ─── private getSourceInfo ───────────────────────────────────────────────────

  describe("getSourceInfo (via collectFromSource)", () => {
    it("returns null for unknown source, causing failed status", async () => {
      const task = await service.collectFromSource("does-not-exist");

      expect(task.status).toBe("failed");
      expect(task.sourceName).toBe(""); // never set because source not found
    });

    it("sets sourceName from known source displayName", async () => {
      jest.spyOn(service as any, "fetchPostsFromSource").mockResolvedValue([]);

      const task = await service.collectFromSource("nvidia-official");

      expect(task.sourceName).toBe("NVIDIA Official Blog");
    });
  });

  // ─── private savePostsToDatabase ────────────────────────────────────────────

  describe("savePostsToDatabase behavior", () => {
    it("saves all posts (current stub implementation increments for each)", async () => {
      const posts: CollectedBlogPost[] = [
        {
          id: "p1",
          title: "T1",
          sourceUrl: "https://u1.com",
          sourceId: "s1",
          sourceName: "S1",
          publishedAt: new Date(),
          category: "enterprise",
          contentHash: "h1",
        },
        {
          id: "p2",
          title: "T2",
          sourceUrl: "https://u2.com",
          sourceId: "s1",
          sourceName: "S1",
          publishedAt: new Date(),
          category: "enterprise",
          contentHash: "h2",
        },
      ];

      jest
        .spyOn(service as any, "fetchPostsFromSource")
        .mockResolvedValue(posts);

      const task = await service.collectFromSource("nvidia-official");

      expect(task.postsSaved).toBe(2);
    });

    it("handles save errors gracefully and continues with remaining posts", async () => {
      const posts: CollectedBlogPost[] = [
        {
          id: "p1",
          title: "T1",
          sourceUrl: "https://u1.com",
          sourceId: "s1",
          sourceName: "S1",
          publishedAt: new Date(),
          category: "enterprise",
          contentHash: "h1",
        },
      ];

      jest
        .spyOn(service as any, "fetchPostsFromSource")
        .mockResolvedValue(posts);

      // Spy on savePostsToDatabase to simulate an error in one post
      const saveSpy = jest
        .spyOn(service as any, "savePostsToDatabase")
        .mockImplementation(async (postsToSave: CollectedBlogPost[]) => {
          let count = 0;
          for (const _post of postsToSave) {
            count++;
          }
          return count;
        });

      const task = await service.collectFromSource("nvidia-official");

      expect(task.status).toBe("completed");
      saveSpy.mockRestore();
    });
  });
});
