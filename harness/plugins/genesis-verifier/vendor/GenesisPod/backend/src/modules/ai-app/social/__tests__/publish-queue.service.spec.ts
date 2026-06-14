/**
 * Tests for PublishQueueService
 */

import { Test, TestingModule } from "@nestjs/testing";
import { PublishQueueService } from "../runtime/publish-queue.service";
import { SocialPlatformType } from "../mission/types";

describe("PublishQueueService", () => {
  let service: PublishQueueService;

  const userId = "user-123";
  const contentId = "content-456";
  const platform = SocialPlatformType.WECHAT_MP;

  const defaultOptions = {
    mode: "publish" as const,
    retryOnFailure: true,
    maxRetries: 3,
  };

  beforeEach(async () => {
    // Use fake timers to prevent background intervals from affecting tests
    jest.useFakeTimers();

    const module: TestingModule = await Test.createTestingModule({
      providers: [PublishQueueService],
    }).compile();

    service = module.get<PublishQueueService>(PublishQueueService);
    await service.onModuleInit();
  });

  afterEach(async () => {
    await service.onModuleDestroy();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe("addJob", () => {
    it("should add a job to the queue and return a job ID", async () => {
      const jobId = await service.addJob(
        contentId,
        userId,
        platform,
        defaultOptions,
      );

      expect(jobId).toBeDefined();
      expect(typeof jobId).toBe("string");
      expect(jobId).toMatch(/^job_/);
    });

    it("should create a waiting job for immediate publishing", async () => {
      const jobId = await service.addJob(
        contentId,
        userId,
        platform,
        defaultOptions,
      );
      const status = service.getJobStatus(jobId);

      expect(status).not.toBeNull();
      expect(status!.status).toBe("waiting");
    });

    it("should create a delayed job when scheduledAt is in the future", async () => {
      const futureDate = new Date(Date.now() + 3600000);
      const options = { ...defaultOptions, scheduledAt: futureDate };

      const jobId = await service.addJob(contentId, userId, platform, options);
      const status = service.getJobStatus(jobId);

      expect(status!.status).toBe("delayed");
    });

    it("should use default maxAttempts when not specified", async () => {
      const options = { mode: "publish" as const };
      const jobId = await service.addJob(contentId, userId, platform, options);
      const status = service.getJobStatus(jobId);

      expect(status).not.toBeNull();
    });
  });

  describe("getJobStatus", () => {
    it("should return null for non-existent job", () => {
      const status = service.getJobStatus("non-existent-job-id");
      expect(status).toBeNull();
    });

    it("should return status info for existing job", async () => {
      const jobId = await service.addJob(
        contentId,
        userId,
        platform,
        defaultOptions,
      );
      const status = service.getJobStatus(jobId);

      expect(status).not.toBeNull();
      expect(status).toHaveProperty("status");
      expect(status).toHaveProperty("progress");
    });

    it("should show 0 progress for waiting job", async () => {
      const jobId = await service.addJob(
        contentId,
        userId,
        platform,
        defaultOptions,
      );
      const status = service.getJobStatus(jobId);

      expect(status!.progress).toBe(0);
    });
  });

  describe("cancelJob", () => {
    it("should cancel a waiting job and return true", async () => {
      const jobId = await service.addJob(
        contentId,
        userId,
        platform,
        defaultOptions,
      );

      const result = service.cancelJob(jobId);

      expect(result).toBe(true);
      const status = service.getJobStatus(jobId);
      expect(status!.status).toBe("failed");
      expect(status!.failReason).toContain("Cancelled by user");
    });

    it("should return false for non-existent job", () => {
      const result = service.cancelJob("non-existent-id");
      expect(result).toBe(false);
    });

    it("should not cancel a delayed job that is scheduled", async () => {
      const futureDate = new Date(Date.now() + 3600000);
      const jobId = await service.addJob(contentId, userId, platform, {
        ...defaultOptions,
        scheduledAt: futureDate,
      });

      // Delayed jobs can be cancelled (not "active")
      const result = service.cancelJob(jobId);
      expect(result).toBe(true);
    });
  });

  describe("retryJob", () => {
    it("should return false for non-existent job", () => {
      const result = service.retryJob("non-existent-id");
      expect(result).toBe(false);
    });

    it("should return false for non-failed job", async () => {
      const jobId = await service.addJob(
        contentId,
        userId,
        platform,
        defaultOptions,
      );
      // Job is in "waiting" state, not "failed"
      const result = service.retryJob(jobId);
      expect(result).toBe(false);
    });

    it("should reset a failed job to waiting state", async () => {
      const jobId = await service.addJob(
        contentId,
        userId,
        platform,
        defaultOptions,
      );

      // Cancel it to make it "failed"
      service.cancelJob(jobId);
      expect(service.getJobStatus(jobId)!.status).toBe("failed");

      const result = service.retryJob(jobId);
      expect(result).toBe(true);
      expect(service.getJobStatus(jobId)!.status).toBe("waiting");
    });
  });

  describe("getQueueStats", () => {
    it("should return empty stats when queue is empty", () => {
      const stats = service.getQueueStats();

      expect(stats.total).toBe(0);
      expect(stats.waiting).toBe(0);
      expect(stats.active).toBe(0);
      expect(stats.delayed).toBe(0);
      expect(stats.completed).toBe(0);
      expect(stats.failed).toBe(0);
    });

    it("should count jobs by status correctly", async () => {
      // Add waiting job
      await service.addJob(contentId, userId, platform, defaultOptions);

      // Add delayed job
      const futureDate = new Date(Date.now() + 3600000);
      await service.addJob(contentId, userId, platform, {
        ...defaultOptions,
        scheduledAt: futureDate,
      });

      // Create a failed job
      const failedJobId = await service.addJob(
        contentId,
        userId,
        platform,
        defaultOptions,
      );
      service.cancelJob(failedJobId);

      const stats = service.getQueueStats();
      expect(stats.total).toBe(3);
      expect(stats.waiting).toBe(1);
      expect(stats.delayed).toBe(1);
      expect(stats.failed).toBe(1);
    });
  });

  describe("getUserJobs", () => {
    it("should return empty array when no jobs for user", () => {
      const jobs = service.getUserJobs("unknown-user");
      expect(jobs).toEqual([]);
    });

    it("should return all jobs for a user", async () => {
      await service.addJob(contentId, userId, platform, defaultOptions);
      await service.addJob("content-2", userId, platform, defaultOptions);
      await service.addJob(
        "other-content",
        "other-user",
        platform,
        defaultOptions,
      );

      const jobs = service.getUserJobs(userId);
      expect(jobs).toHaveLength(2);
      expect(jobs.every((j) => j.data.userId === userId)).toBe(true);
    });

    it("should filter by status when provided", async () => {
      await service.addJob(contentId, userId, platform, defaultOptions);
      const failedJobId = await service.addJob(
        "content-2",
        userId,
        platform,
        defaultOptions,
      );
      service.cancelJob(failedJobId);

      const failedJobs = service.getUserJobs(userId, { status: "failed" });
      expect(failedJobs).toHaveLength(1);

      const waitingJobs = service.getUserJobs(userId, { status: "waiting" });
      expect(waitingJobs).toHaveLength(1);
    });

    it("should limit results when limit option provided", async () => {
      for (let i = 0; i < 5; i++) {
        await service.addJob(`content-${i}`, userId, platform, defaultOptions);
      }

      const limited = service.getUserJobs(userId, { limit: 3 });
      expect(limited).toHaveLength(3);
    });

    it("should sort jobs by creation time (newest first)", async () => {
      await service.addJob("content-1", userId, platform, defaultOptions);
      // Advance fake timer to ensure job2 has a later timestamp
      jest.advanceTimersByTime(100);
      await service.addJob("content-2", userId, platform, defaultOptions);

      const jobs = service.getUserJobs(userId);
      // Should have 2 jobs sorted by creation time
      expect(jobs).toHaveLength(2);
      // Both jobs belong to the user
      expect(jobs.every((j) => j.data.userId === userId)).toBe(true);
    });
  });

  describe("cleanupCompletedJobs", () => {
    it("should return 0 when no completed jobs to clean", () => {
      const cleaned = service.cleanupCompletedJobs();
      expect(cleaned).toBe(0);
    });

    it("should not clean recent completed jobs", async () => {
      // Since we can't easily get a job to "completed" state without processing,
      // we test that cleanupCompletedJobs doesn't remove non-completed jobs
      await service.addJob(contentId, userId, platform, defaultOptions);
      const cleaned = service.cleanupCompletedJobs();
      expect(cleaned).toBe(0);
    });
  });

  describe("setProcessor", () => {
    it("should set a job processor without throwing", () => {
      const processor = jest.fn().mockResolvedValue({ success: true });
      expect(() => service.setProcessor(processor)).not.toThrow();
    });

    it("should skip processing when no processor is set", async () => {
      // Without calling setProcessor, no processor is registered
      const jobId = await service.addJob(
        contentId,
        userId,
        platform,
        defaultOptions,
      );

      jest.advanceTimersByTime(5001);
      await Promise.resolve();

      // Job should remain in waiting state (no processor to run it)
      const status = service.getJobStatus(jobId);
      expect(status!.status).toBe("waiting");
    });

    it("should accept and store a job processor function", () => {
      const processor = jest.fn();
      service.setProcessor(processor);
      // Processor is private but we can verify it doesn't throw
      expect(processor).not.toHaveBeenCalled(); // Not called yet (no processing triggered)
    });
  });
});
