import { Test, TestingModule } from "@nestjs/testing";
import { getQueueToken } from "@nestjs/bullmq";
import { RadarBriefingQueueService } from "../radar-briefing-queue.service";
import { CacheService } from "../../../../../../../common/cache/cache.service";

describe("RadarBriefingQueueService", () => {
  let service: RadarBriefingQueueService;
  let mockQueue: {
    add: jest.Mock;
    getWaitingCount: jest.Mock;
    getActiveCount: jest.Mock;
    getFailedCount: jest.Mock;
  };
  let mockCache: { incrby: jest.Mock; expire: jest.Mock };

  beforeEach(async () => {
    mockQueue = {
      add: jest.fn().mockResolvedValue({ id: "job-123" }),
      getWaitingCount: jest.fn().mockResolvedValue(5),
      getActiveCount: jest.fn().mockResolvedValue(3),
      getFailedCount: jest.fn().mockResolvedValue(1),
    };

    mockCache = {
      incrby: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RadarBriefingQueueService,
        {
          provide: getQueueToken(RadarBriefingQueueService.QUEUE_NAME),
          useValue: mockQueue,
        },
        { provide: CacheService, useValue: mockCache },
      ],
    }).compile();

    service = module.get(RadarBriefingQueueService);
  });

  describe("enqueue", () => {
    it("first call succeeds, sets EXPIRE, and returns jobId", async () => {
      mockCache.incrby.mockResolvedValueOnce(1);

      const result = await service.enqueue("user-1", {
        type: "daily",
        topicId: "topic-abc",
      });

      expect(result.enqueued).toBe(true);
      expect(result.jobId).toBe("job-123");
      // count === 1 so EXPIRE must be called
      expect(mockCache.expire).toHaveBeenCalledWith(
        expect.stringContaining("radar:briefing:user-quota:user-1:"),
        86400,
      );
      expect(mockQueue.add).toHaveBeenCalledWith(
        "daily",
        { type: "daily", topicId: "topic-abc" },
        expect.objectContaining({ attempts: 2 }),
      );
    });

    it("returns rate-limited on 11th call without enqueuing", async () => {
      mockCache.incrby.mockResolvedValueOnce(
        RadarBriefingQueueService.USER_DAILY_QUOTA + 1,
      );

      const result = await service.enqueue("user-2", {
        type: "weekly",
        topicId: "topic-xyz",
        briefingDate: "2026-05-18",
      });

      expect(result.enqueued).toBe(false);
      expect(result.reason).toBe("rate-limited");
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it("fail-open when Redis throws: enqueues anyway", async () => {
      mockCache.incrby.mockRejectedValueOnce(
        new Error("Redis connection lost"),
      );

      const result = await service.enqueue("user-3", {
        type: "daily",
        topicId: "topic-err",
      });

      expect(result.enqueued).toBe(true);
      expect(result.jobId).toBe("job-123");
      expect(mockQueue.add).toHaveBeenCalledTimes(1);
    });
  });

  describe("getStats", () => {
    it("returns waiting, active, failed counts", async () => {
      const stats = await service.getStats();

      expect(stats).toEqual({ waiting: 5, active: 3, failed: 1 });
    });
  });
});
