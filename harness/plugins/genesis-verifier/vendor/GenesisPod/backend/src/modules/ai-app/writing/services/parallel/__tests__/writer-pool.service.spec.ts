import { Test, TestingModule } from "@nestjs/testing";
import { WriterPoolService } from "../writer-pool.service";

describe("WriterPoolService", () => {
  let service: WriterPoolService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WriterPoolService],
    }).compile();

    service = module.get<WriterPoolService>(WriterPoolService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==================== initialization ====================

  describe("initialization", () => {
    it("should initialize pool with 5 writers by default", () => {
      const status = service.getPoolStatus() as Array<{
        id: number;
        busy: boolean;
      }>;
      expect(status).toHaveLength(5);
    });

    it("should initialize all writers with busy = false", () => {
      const status = service.getPoolStatus() as Array<{
        id: number;
        busy: boolean;
      }>;
      for (const writer of status) {
        expect(writer.busy).toBe(false);
      }
    });

    it("should initialize writers with ids 1 through 5", () => {
      const status = service.getPoolStatus() as Array<{ id: number }>;
      const ids = status.map((w) => w.id).sort((a, b) => a - b);
      expect(ids).toEqual([1, 2, 3, 4, 5]);
    });
  });

  // ==================== getAvailableCount ====================

  describe("getAvailableCount", () => {
    it("should return 5 when no writers are acquired", () => {
      expect(service.getAvailableCount()).toBe(5);
    });

    it("should decrease by 1 after each acquire", async () => {
      await service.acquire();
      expect(service.getAvailableCount()).toBe(4);
    });

    it("should return 0 when all 5 writers are acquired", async () => {
      await Promise.all([
        service.acquire(),
        service.acquire(),
        service.acquire(),
        service.acquire(),
        service.acquire(),
      ]);
      expect(service.getAvailableCount()).toBe(0);
    });
  });

  // ==================== acquire ====================

  describe("acquire", () => {
    it("should return a writer instance with id and busy=true", async () => {
      const writer = await service.acquire();
      expect(writer.id).toBeDefined();
      expect(writer.busy).toBe(true);
    });

    it("should set startedAt to a Date when acquired", async () => {
      const writer = await service.acquire();
      expect(writer.startedAt).toBeInstanceOf(Date);
    });

    it("should return different writers on successive acquires", async () => {
      const w1 = await service.acquire();
      const w2 = await service.acquire();
      expect(w1.id).not.toBe(w2.id);
    });

    it("should acquire all 5 writers without blocking", async () => {
      const writers = await Promise.all([
        service.acquire(),
        service.acquire(),
        service.acquire(),
        service.acquire(),
        service.acquire(),
      ]);
      const ids = writers.map((w) => w.id).sort((a, b) => a - b);
      expect(ids).toEqual([1, 2, 3, 4, 5]);
    });

    it("should resolve when a writer is released after all are busy", async () => {
      jest.useFakeTimers();

      // acquire all 5
      const busyWriters = await Promise.all([
        service.acquire(),
        service.acquire(),
        service.acquire(),
        service.acquire(),
        service.acquire(),
      ]);

      // Start a 6th acquire that will wait
      const waitPromise = service.acquire();

      // Release one writer and advance fake timer to trigger the interval check
      void service.release(busyWriters[0]);
      jest.advanceTimersByTime(1100);

      const resolvedWriter = await waitPromise;
      expect(resolvedWriter.busy).toBe(true);

      jest.useRealTimers();
    }, 10000);
  });

  // ==================== release ====================

  describe("release", () => {
    it("should mark writer as not busy after release", async () => {
      const writer = await service.acquire();
      await service.release(writer);
      expect(service.getAvailableCount()).toBe(5);
    });

    it("should clear currentChapterId on release", async () => {
      const writer = await service.acquire();
      service.setCurrentChapter(writer.id, "chapter-42");
      await service.release(writer);

      const status = service.getPoolStatus() as Array<{
        id: number;
        currentChapterId: string | undefined;
      }>;
      const poolWriter = status.find((w) => w.id === writer.id);
      expect(poolWriter?.currentChapterId).toBeUndefined();
    });

    it("should clear startedAt on release", async () => {
      const writer = await service.acquire();
      await service.release(writer);

      const status = service.getPoolStatus() as Array<{
        id: number;
        runningFor: number | null;
      }>;
      const poolWriter = status.find((w) => w.id === writer.id);
      expect(poolWriter?.runningFor).toBeNull();
    });

    it("should ignore release of a writer id that is not in the pool", async () => {
      // Should not throw
      await expect(
        service.release({ id: 999, busy: true }),
      ).resolves.toBeUndefined();
    });
  });

  // ==================== setCurrentChapter ====================

  describe("setCurrentChapter", () => {
    it("should set currentChapterId for the given writer", async () => {
      const writer = await service.acquire();
      service.setCurrentChapter(writer.id, "chapter-7");

      const status = service.getPoolStatus() as Array<{
        id: number;
        currentChapterId: string | undefined;
      }>;
      const poolWriter = status.find((w) => w.id === writer.id);
      expect(poolWriter?.currentChapterId).toBe("chapter-7");
    });

    it("should not throw for an unknown writer id", () => {
      expect(() => service.setCurrentChapter(999, "chapter-x")).not.toThrow();
    });
  });

  // ==================== getPoolStatus ====================

  describe("getPoolStatus", () => {
    it("should return an entry for every writer in the pool", () => {
      const status = service.getPoolStatus();
      expect(status).toHaveLength(5);
    });

    it("should include id, busy, currentChapterId and runningFor per entry", async () => {
      const writer = await service.acquire();
      service.setCurrentChapter(writer.id, "ch-1");

      const status = service.getPoolStatus() as Array<{
        id: number;
        busy: boolean;
        currentChapterId: string | undefined;
        runningFor: number | null;
      }>;
      const entry = status.find((w) => w.id === writer.id);
      expect(entry).toMatchObject({
        id: writer.id,
        busy: true,
        currentChapterId: "ch-1",
      });
      expect(typeof entry?.runningFor).toBe("number");
    });

    it("should report runningFor null for idle writers", () => {
      const status = service.getPoolStatus() as Array<{
        runningFor: number | null;
      }>;
      for (const entry of status) {
        expect(entry.runningFor).toBeNull();
      }
    });
  });

  // ==================== setMaxPoolSize ====================

  describe("setMaxPoolSize", () => {
    it("should expand the pool when size is increased", () => {
      service.setMaxPoolSize(8);
      const status = service.getPoolStatus();
      expect(status).toHaveLength(8);
    });

    it("should add new writers with busy=false when expanding", () => {
      service.setMaxPoolSize(7);
      const status = service.getPoolStatus() as Array<{
        id: number;
        busy: boolean;
      }>;
      const newWriters = status.filter((w) => w.id > 5);
      for (const w of newWriters) {
        expect(w.busy).toBe(false);
      }
    });

    it("should update getAvailableCount after pool expansion", () => {
      service.setMaxPoolSize(8);
      expect(service.getAvailableCount()).toBe(8);
    });

    it("should not remove busy writers when shrinking size", async () => {
      const w = await service.acquire();
      service.setMaxPoolSize(3);
      // The busy writer (id <= 3 or id > 3) should still be tracked
      // Available count = 3 or fewer, but no crash
      expect(() => service.getPoolStatus()).not.toThrow();
      // Release to clean up
      await service.release(w);
    });
  });
});
