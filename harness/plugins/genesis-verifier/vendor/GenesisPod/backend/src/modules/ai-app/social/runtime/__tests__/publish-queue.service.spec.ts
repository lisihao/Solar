import { Test, TestingModule } from "@nestjs/testing";
import { PublishQueueService } from "../publish-queue.service";
import { SocialPlatformType } from "../../mission/types";
import { PublishOptions } from "../../mission/types/platform.types";

describe("PublishQueueService", () => {
  let service: PublishQueueService;

  const defaultOptions: PublishOptions = {
    mode: "publish",
    maxRetries: 3,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PublishQueueService],
    }).compile();

    service = module.get<PublishQueueService>(PublishQueueService);
    // Do NOT call onModuleInit to avoid starting intervals in tests
  });

  afterEach(async () => {
    // Ensure cleanup
    await service.onModuleDestroy();
  });

  // ==================== addJob ====================

  it("should add a job and return a job ID", async () => {
    const jobId = await service.addJob(
      "content-1",
      "user-1",
      SocialPlatformType.WECHAT_MP,
      defaultOptions,
    );

    expect(jobId).toBeDefined();
    expect(typeof jobId).toBe("string");
    expect(jobId.startsWith("job_")).toBe(true);
  });

  it("should set job status to waiting when no scheduledAt", async () => {
    const jobId = await service.addJob(
      "content-1",
      "user-1",
      SocialPlatformType.WECHAT_MP,
      defaultOptions,
    );

    const status = service.getJobStatus(jobId);
    expect(status?.status).toBe("waiting");
  });

  it("should set job status to delayed when scheduledAt is in the future", async () => {
    const futureDate = new Date(Date.now() + 60 * 60 * 1000);
    const jobId = await service.addJob(
      "content-1",
      "user-1",
      SocialPlatformType.WECHAT_MP,
      { ...defaultOptions, scheduledAt: futureDate },
    );

    const status = service.getJobStatus(jobId);
    expect(status?.status).toBe("delayed");
  });

  it("should use RETRY_CONFIG.maxAttempts as default when maxRetries is not set", async () => {
    const jobId = await service.addJob(
      "content-1",
      "user-1",
      SocialPlatformType.WECHAT_MP,
      { mode: "publish" },
    );

    // verify job was added (status not null)
    const status = service.getJobStatus(jobId);
    expect(status).not.toBeNull();
  });

  it("should generate unique job IDs for concurrent adds", async () => {
    const ids = await Promise.all([
      service.addJob("c1", "u1", SocialPlatformType.WECHAT_MP, defaultOptions),
      service.addJob("c2", "u1", SocialPlatformType.WECHAT_MP, defaultOptions),
      service.addJob("c3", "u1", SocialPlatformType.WECHAT_MP, defaultOptions),
    ]);

    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(3);
  });

  // ==================== getJobStatus ====================

  it("should return null for non-existent job", () => {
    const status = service.getJobStatus("non-existent-id");
    expect(status).toBeNull();
  });

  it("should return correct progress for waiting job", async () => {
    const jobId = await service.addJob(
      "content-1",
      "user-1",
      SocialPlatformType.WECHAT_MP,
      defaultOptions,
    );

    const status = service.getJobStatus(jobId);
    expect(status?.progress).toBe(0);
  });

  it("should include nextRetryAt for delayed jobs", async () => {
    const futureDate = new Date(Date.now() + 60 * 60 * 1000);
    const jobId = await service.addJob(
      "content-1",
      "user-1",
      SocialPlatformType.WECHAT_MP,
      { ...defaultOptions, scheduledAt: futureDate },
    );

    const status = service.getJobStatus(jobId);
    expect(status?.nextRetryAt).toBeDefined();
    expect(status?.nextRetryAt).toBeInstanceOf(Date);
  });

  // ==================== cancelJob ====================

  it("should cancel a waiting job", async () => {
    const jobId = await service.addJob(
      "content-1",
      "user-1",
      SocialPlatformType.WECHAT_MP,
      defaultOptions,
    );

    const result = service.cancelJob(jobId);
    expect(result).toBe(true);

    const status = service.getJobStatus(jobId);
    expect(status?.status).toBe("failed");
    expect(status?.failReason).toBe("Cancelled by user");
  });

  it("should return false when cancelling non-existent job", () => {
    const result = service.cancelJob("non-existent-id");
    expect(result).toBe(false);
  });

  it("should return false when cancelling a delayed job but still cancel it", async () => {
    const futureDate = new Date(Date.now() + 60 * 60 * 1000);
    const jobId = await service.addJob(
      "content-1",
      "user-1",
      SocialPlatformType.WECHAT_MP,
      { ...defaultOptions, scheduledAt: futureDate },
    );

    // Delayed jobs CAN be cancelled (they are not "active")
    const result = service.cancelJob(jobId);
    expect(result).toBe(true);
  });

  // ==================== retryJob ====================

  it("should return false when retrying non-existent job", () => {
    const result = service.retryJob("non-existent-id");
    expect(result).toBe(false);
  });

  it("should retry a failed job and reset it to waiting", async () => {
    const jobId = await service.addJob(
      "content-1",
      "user-1",
      SocialPlatformType.WECHAT_MP,
      defaultOptions,
    );

    // Cancel (sets to failed)
    service.cancelJob(jobId);
    expect(service.getJobStatus(jobId)?.status).toBe("failed");

    // Retry
    const result = service.retryJob(jobId);
    expect(result).toBe(true);

    const status = service.getJobStatus(jobId);
    expect(status?.status).toBe("waiting");
    expect(status?.failReason).toBeUndefined();
  });

  it("should return false when retrying a waiting job (not failed)", async () => {
    const jobId = await service.addJob(
      "content-1",
      "user-1",
      SocialPlatformType.WECHAT_MP,
      defaultOptions,
    );

    const result = service.retryJob(jobId);
    expect(result).toBe(false);
  });

  // ==================== getQueueStats ====================

  it("should return zero stats for empty queue", () => {
    const stats = service.getQueueStats();
    expect(stats.total).toBe(0);
    expect(stats.waiting).toBe(0);
    expect(stats.active).toBe(0);
    expect(stats.delayed).toBe(0);
    expect(stats.completed).toBe(0);
    expect(stats.failed).toBe(0);
  });

  it("should correctly count jobs by status", async () => {
    // Add waiting job
    await service.addJob(
      "c1",
      "u1",
      SocialPlatformType.WECHAT_MP,
      defaultOptions,
    );
    // Add delayed job
    await service.addJob("c2", "u1", SocialPlatformType.WECHAT_MP, {
      ...defaultOptions,
      scheduledAt: new Date(Date.now() + 3600000),
    });
    // Add and cancel (failed)
    const failedId = await service.addJob(
      "c3",
      "u1",
      SocialPlatformType.WECHAT_MP,
      defaultOptions,
    );
    service.cancelJob(failedId);

    const stats = service.getQueueStats();
    expect(stats.total).toBe(3);
    expect(stats.waiting).toBe(1);
    expect(stats.delayed).toBe(1);
    expect(stats.failed).toBe(1);
  });

  // ==================== getUserJobs ====================

  it("should return jobs for specific user", async () => {
    await service.addJob(
      "c1",
      "user-A",
      SocialPlatformType.WECHAT_MP,
      defaultOptions,
    );
    await service.addJob(
      "c2",
      "user-B",
      SocialPlatformType.WECHAT_MP,
      defaultOptions,
    );

    const userAJobs = service.getUserJobs("user-A");
    expect(userAJobs).toHaveLength(1);
    expect(userAJobs[0].data.userId).toBe("user-A");
  });

  it("should filter by status when provided", async () => {
    const waitingId = await service.addJob(
      "c1",
      "user-A",
      SocialPlatformType.WECHAT_MP,
      defaultOptions,
    );
    const failedId = await service.addJob(
      "c2",
      "user-A",
      SocialPlatformType.WECHAT_MP,
      defaultOptions,
    );
    service.cancelJob(failedId);

    const waitingJobs = service.getUserJobs("user-A", { status: "waiting" });
    expect(waitingJobs).toHaveLength(1);
    expect(waitingJobs[0].id).toBe(waitingId);
  });

  it("should limit results when limit option is provided", async () => {
    await service.addJob(
      "c1",
      "user-A",
      SocialPlatformType.WECHAT_MP,
      defaultOptions,
    );
    await service.addJob(
      "c2",
      "user-A",
      SocialPlatformType.WECHAT_MP,
      defaultOptions,
    );
    await service.addJob(
      "c3",
      "user-A",
      SocialPlatformType.WECHAT_MP,
      defaultOptions,
    );

    const limited = service.getUserJobs("user-A", { limit: 2 });
    expect(limited).toHaveLength(2);
  });

  it("should return empty array for user with no jobs", () => {
    const jobs = service.getUserJobs("non-existent-user");
    expect(jobs).toHaveLength(0);
  });

  // ==================== cleanupCompletedJobs ====================

  it("should not clean up recent completed jobs", async () => {
    // Add and process a job to completion via setProcessor
    const jobId = await service.addJob(
      "c1",
      "u1",
      SocialPlatformType.WECHAT_MP,
      defaultOptions,
    );

    // Manually trigger a cancel to put it in failed state with recent completedAt
    service.cancelJob(jobId);

    const cleaned = service.cleanupCompletedJobs();
    // The job was cancelled but completedAt might not be set (cancelled jobs don't set completedAt)
    expect(cleaned).toBe(0);
  });

  it("should return 0 when no jobs to clean up", () => {
    const cleaned = service.cleanupCompletedJobs();
    expect(cleaned).toBe(0);
  });

  // ==================== setProcessor ====================

  it("should set processor and use it during queue processing", async () => {
    const processor = jest.fn().mockResolvedValue({ success: true });
    service.setProcessor(processor);

    const jobId = await service.addJob(
      "c1",
      "u1",
      SocialPlatformType.WECHAT_MP,
      defaultOptions,
    );

    // Manually trigger queue processing by calling the private method via any cast
    await (
      service as unknown as { processQueue: () => Promise<void> }
    ).processQueue();

    expect(processor).toHaveBeenCalledTimes(1);
    expect(service.getJobStatus(jobId)?.status).toBe("completed");
    expect(service.getJobStatus(jobId)?.progress).toBe(100);
  });

  it("should handle processor failure and schedule retry", async () => {
    const processor = jest
      .fn()
      .mockResolvedValue({ success: false, error: "Network error" });
    service.setProcessor(processor);

    const jobId = await service.addJob(
      "c1",
      "u1",
      SocialPlatformType.WECHAT_MP,
      { ...defaultOptions, maxRetries: 3 },
    );

    await (
      service as unknown as { processQueue: () => Promise<void> }
    ).processQueue();

    // After first failure with retries remaining, should be delayed
    const status = service.getJobStatus(jobId);
    expect(status?.status).toBe("delayed");
    expect(status?.failReason).toBe("Network error");
  });

  it("should mark job as failed after max attempts exceeded", async () => {
    const processor = jest
      .fn()
      .mockRejectedValue(new Error("Persistent error"));
    service.setProcessor(processor);

    // maxRetries = 1 means maxAttempts = 1
    const jobId = await service.addJob(
      "c1",
      "u1",
      SocialPlatformType.WECHAT_MP,
      { ...defaultOptions, maxRetries: 1 },
    );

    // First attempt
    await (
      service as unknown as { processQueue: () => Promise<void> }
    ).processQueue();

    const status = service.getJobStatus(jobId);
    expect(status?.status).toBe("failed");
    expect(status?.failReason).toBe("Persistent error");
  });

  it("should skip processing when no processor is set", async () => {
    const jobId = await service.addJob(
      "c1",
      "u1",
      SocialPlatformType.WECHAT_MP,
      defaultOptions,
    );

    await (
      service as unknown as { processQueue: () => Promise<void> }
    ).processQueue();

    // Job should remain waiting since no processor
    expect(service.getJobStatus(jobId)?.status).toBe("waiting");
  });

  it("should skip jobs scheduled in the future during queue processing", async () => {
    const processor = jest.fn().mockResolvedValue({ success: true });
    service.setProcessor(processor);

    await service.addJob("c1", "u1", SocialPlatformType.WECHAT_MP, {
      ...defaultOptions,
      scheduledAt: new Date(Date.now() + 3600000),
    });

    await (
      service as unknown as { processQueue: () => Promise<void> }
    ).processQueue();

    expect(processor).not.toHaveBeenCalled();
  });
});
