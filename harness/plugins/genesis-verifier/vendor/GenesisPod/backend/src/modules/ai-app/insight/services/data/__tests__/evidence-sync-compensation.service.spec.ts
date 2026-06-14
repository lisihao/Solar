/**
 * EvidenceSyncCompensationService Unit Tests
 *
 * 测试要点：
 * - queueForRetry(): 添加待补偿记录
 * - processRetryQueue(): 重试逻辑和最大重试次数
 * - getStats(): 统计信息正确性
 * - 队列容量限制
 * - 永久失败处理
 */

import { Test, TestingModule } from "@nestjs/testing";
import { EvidenceSyncCompensationService } from "../evidence-sync-compensation.service";
import { TeamFacade } from "@/modules/ai-harness/facade";
import { SaveEvidenceRequest } from "@/modules/ai-harness/facade";

describe("EvidenceSyncCompensationService", () => {
  let service: EvidenceSyncCompensationService;
  let mockFacade: { evidenceSave: jest.Mock };

  // Mock data
  const mockTopicEvidenceId = "topic-evidence-123";
  const mockSaveRequest: SaveEvidenceRequest = {
    type: "FACT",
    source: {
      url: "https://example.com/article",
      title: "Test Article",
      domain: "example.com",
    },
    content: {
      original: "Test content",
      snippet: "Test snippet",
    },
    associations: {
      entityType: "research_report",
      entityId: "report-123",
    },
    relevanceScore: 0.5,
  };

  beforeEach(async () => {
    mockFacade = {
      evidenceSave: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EvidenceSyncCompensationService,
        {
          provide: TeamFacade,
          useValue: mockFacade,
        },
      ],
    }).compile();

    service = module.get<EvidenceSyncCompensationService>(
      EvidenceSyncCompensationService,
    );

    // Clear interval to prevent side effects
    service.onModuleDestroy();
  });

  afterEach(() => {
    jest.clearAllMocks();
    service.onModuleDestroy();
  });

  // ==================== queueForRetry ====================

  describe("queueForRetry", () => {
    it("should add entry to pending queue", () => {
      // Act
      service.queueForRetry(mockTopicEvidenceId, mockSaveRequest, "Test error");

      // Assert
      const stats = service.getStats();
      expect(stats.pendingCount).toBe(1);

      const pendingEntries = service.getPendingEntries();
      expect(pendingEntries).toHaveLength(1);
      expect(pendingEntries[0].topicEvidenceId).toBe(mockTopicEvidenceId);
      expect(pendingEntries[0].request).toEqual(mockSaveRequest);
      expect(pendingEntries[0].lastError).toBe("Test error");
      expect(pendingEntries[0].retryCount).toBe(0);
    });

    it("should generate unique ID for each entry", async () => {
      // Act - use different topicEvidenceIds and small delay to ensure unique IDs
      service.queueForRetry("topic-evidence-1", mockSaveRequest, "Error 1");

      // Small delay to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));

      service.queueForRetry("topic-evidence-2", mockSaveRequest, "Error 2");

      // Assert
      const pendingEntries = service.getPendingEntries();
      expect(pendingEntries).toHaveLength(2);
      expect(pendingEntries[0].id).not.toBe(pendingEntries[1].id);
    });

    it("should drop oldest entry when queue is full", () => {
      // Arrange - fill queue to capacity (1000)
      for (let i = 0; i < 1000; i++) {
        service.queueForRetry(`evidence-${i}`, mockSaveRequest, `Error ${i}`);
      }

      const firstEntry = service.getPendingEntries()[0];

      // Act - add one more to exceed capacity
      service.queueForRetry("evidence-1000", mockSaveRequest, "Error 1000");

      // Assert
      const stats = service.getStats();
      expect(stats.pendingCount).toBe(1000); // Should remain at max

      const pendingEntries = service.getPendingEntries();
      expect(
        pendingEntries.find((e) => e.id === firstEntry.id),
      ).toBeUndefined(); // First entry removed
      expect(pendingEntries[pendingEntries.length - 1].topicEvidenceId).toBe(
        "evidence-1000",
      ); // New entry added
    });

    it("should set createdAt timestamp", () => {
      // Arrange
      const beforeTime = new Date();

      // Act
      service.queueForRetry(mockTopicEvidenceId, mockSaveRequest, "Test error");

      // Assert
      const afterTime = new Date();
      const entry = service.getPendingEntries()[0];
      expect(entry.createdAt.getTime()).toBeGreaterThanOrEqual(
        beforeTime.getTime(),
      );
      expect(entry.createdAt.getTime()).toBeLessThanOrEqual(
        afterTime.getTime(),
      );
    });
  });

  // ==================== processRetryQueue ====================

  describe("processRetryQueue", () => {
    it("should do nothing when queue is empty", async () => {
      // Act
      await service.processRetryQueue();

      // Assert
      expect(mockFacade.evidenceSave).not.toHaveBeenCalled();
    });

    it("should retry pending entries and remove on success", async () => {
      // Arrange
      service.queueForRetry(
        mockTopicEvidenceId,
        mockSaveRequest,
        "Initial error",
      );
      mockFacade.evidenceSave.mockResolvedValue(undefined);

      // Act
      await service.processRetryQueue();

      // Assert
      expect(mockFacade.evidenceSave).toHaveBeenCalledWith(mockSaveRequest);

      const stats = service.getStats();
      expect(stats.pendingCount).toBe(0); // Removed from queue
      expect(stats.successCount).toBe(1);
    });

    it("should increment retry count on failure", async () => {
      // Arrange
      service.queueForRetry(
        mockTopicEvidenceId,
        mockSaveRequest,
        "Initial error",
      );
      mockFacade.evidenceSave.mockRejectedValue(new Error("Retry failed"));

      // Act
      await service.processRetryQueue();

      // Assert
      const pendingEntries = service.getPendingEntries();
      expect(pendingEntries).toHaveLength(1);
      expect(pendingEntries[0].retryCount).toBe(1);
      expect(pendingEntries[0].lastError).toBe("Retry failed");
      expect(pendingEntries[0].lastRetryAt).toBeDefined();
    });

    it("should move to permanently failed after max retries", async () => {
      // Arrange
      service.queueForRetry(
        mockTopicEvidenceId,
        mockSaveRequest,
        "Initial error",
      );
      mockFacade.evidenceSave.mockRejectedValue(new Error("Persistent error"));

      // Act - retry 3 times (MAX_RETRIES)
      await service.processRetryQueue();
      await service.processRetryQueue();
      await service.processRetryQueue();

      // Assert
      const stats = service.getStats();
      expect(stats.pendingCount).toBe(0); // Removed from pending
      expect(stats.permanentlyFailedCount).toBe(1); // Moved to permanent failure
      expect(stats.failedCount).toBe(1);

      const permanentlyFailed = service.getPermanentlyFailedEntries();
      expect(permanentlyFailed).toHaveLength(1);
      expect(permanentlyFailed[0].retryCount).toBe(3);
      expect(permanentlyFailed[0].lastError).toBe("Persistent error");
    });

    it("should process multiple entries in batch", async () => {
      // Arrange
      service.queueForRetry("evidence-1", mockSaveRequest, "Error 1");
      service.queueForRetry("evidence-2", mockSaveRequest, "Error 2");
      service.queueForRetry("evidence-3", mockSaveRequest, "Error 3");

      mockFacade.evidenceSave.mockResolvedValue(undefined);

      // Act
      await service.processRetryQueue();

      // Assert
      expect(mockFacade.evidenceSave).toHaveBeenCalledTimes(3);

      const stats = service.getStats();
      expect(stats.pendingCount).toBe(0);
      expect(stats.successCount).toBe(3);
    });

    it("should handle mixed success and failure", async () => {
      // Arrange
      service.queueForRetry("evidence-success", mockSaveRequest, "Error");
      service.queueForRetry("evidence-fail", mockSaveRequest, "Error");

      mockFacade.evidenceSave
        .mockResolvedValueOnce(undefined) // First succeeds
        .mockRejectedValueOnce(new Error("Failed")); // Second fails

      // Act
      await service.processRetryQueue();

      // Assert
      const stats = service.getStats();
      expect(stats.pendingCount).toBe(1); // One still pending
      expect(stats.successCount).toBe(1);

      const pendingEntries = service.getPendingEntries();
      expect(pendingEntries[0].topicEvidenceId).toBe("evidence-fail");
      expect(pendingEntries[0].retryCount).toBe(1);
    });

    it("should handle non-Error exceptions", async () => {
      // Arrange
      service.queueForRetry(
        mockTopicEvidenceId,
        mockSaveRequest,
        "Initial error",
      );
      mockFacade.evidenceSave.mockRejectedValue("String error");

      // Act
      await service.processRetryQueue();

      // Assert
      const pendingEntries = service.getPendingEntries();
      expect(pendingEntries[0].lastError).toBe("String error");
    });

    it("should update lastRetryAt timestamp", async () => {
      // Arrange
      service.queueForRetry(
        mockTopicEvidenceId,
        mockSaveRequest,
        "Initial error",
      );
      mockFacade.evidenceSave.mockRejectedValue(new Error("Retry failed"));

      const beforeTime = new Date();

      // Act
      await service.processRetryQueue();

      // Assert
      const afterTime = new Date();
      const entry = service.getPendingEntries()[0];
      expect(entry.lastRetryAt).toBeDefined();
      expect(entry.lastRetryAt!.getTime()).toBeGreaterThanOrEqual(
        beforeTime.getTime(),
      );
      expect(entry.lastRetryAt!.getTime()).toBeLessThanOrEqual(
        afterTime.getTime(),
      );
    });
  });

  // ==================== getStats ====================

  describe("getStats", () => {
    it("should return correct initial stats", () => {
      // Act
      const stats = service.getStats();

      // Assert
      expect(stats).toEqual({
        pendingCount: 0,
        successCount: 0,
        failedCount: 0,
        permanentlyFailedCount: 0,
      });
    });

    it("should track pending count correctly", () => {
      // Arrange
      service.queueForRetry("evidence-1", mockSaveRequest, "Error");
      service.queueForRetry("evidence-2", mockSaveRequest, "Error");

      // Act
      const stats = service.getStats();

      // Assert
      expect(stats.pendingCount).toBe(2);
    });

    it("should track success count correctly", async () => {
      // Arrange
      service.queueForRetry("evidence-1", mockSaveRequest, "Error");
      mockFacade.evidenceSave.mockResolvedValue(undefined);

      // Act
      await service.processRetryQueue();
      const stats = service.getStats();

      // Assert
      expect(stats.successCount).toBe(1);
    });

    it("should track failed count correctly", async () => {
      // Arrange
      service.queueForRetry("evidence-1", mockSaveRequest, "Error");
      mockFacade.evidenceSave.mockRejectedValue(new Error("Failed"));

      // Act - retry 3 times to trigger permanent failure
      await service.processRetryQueue();
      await service.processRetryQueue();
      await service.processRetryQueue();

      const stats = service.getStats();

      // Assert
      expect(stats.failedCount).toBe(1);
    });

    it("should track permanently failed count correctly", async () => {
      // Arrange
      service.queueForRetry("evidence-1", mockSaveRequest, "Error");
      service.queueForRetry("evidence-2", mockSaveRequest, "Error");
      mockFacade.evidenceSave.mockRejectedValue(new Error("Failed"));

      // Act - retry 3 times for both
      for (let i = 0; i < 3; i++) {
        await service.processRetryQueue();
      }

      const stats = service.getStats();

      // Assert
      expect(stats.permanentlyFailedCount).toBe(2);
    });

    it("should provide cumulative statistics", async () => {
      // Arrange - create multiple entries with different outcomes
      service.queueForRetry("success-1", mockSaveRequest, "Error");
      service.queueForRetry("success-2", mockSaveRequest, "Error");
      service.queueForRetry("pending-1", mockSaveRequest, "Error");
      service.queueForRetry("fail-1", mockSaveRequest, "Error");

      mockFacade.evidenceSave
        .mockResolvedValueOnce(undefined) // success-1
        .mockResolvedValueOnce(undefined) // success-2
        .mockRejectedValueOnce(new Error("Retry")) // pending-1
        .mockRejectedValueOnce(new Error("Fail")); // fail-1

      // Act
      await service.processRetryQueue();

      // More retries for permanent failure
      mockFacade.evidenceSave.mockRejectedValue(new Error("Fail"));
      await service.processRetryQueue();
      await service.processRetryQueue();

      const stats = service.getStats();

      // Assert
      expect(stats.successCount).toBe(2);
      expect(stats.pendingCount).toBe(0); // All processed
      expect(stats.failedCount).toBe(2); // Both pending-1 and fail-1 eventually failed
      expect(stats.permanentlyFailedCount).toBe(2);
    });
  });

  // ==================== getPendingEntries ====================

  describe("getPendingEntries", () => {
    it("should return empty array when no pending entries", () => {
      // Act
      const entries = service.getPendingEntries();

      // Assert
      expect(entries).toEqual([]);
    });

    it("should return all pending entries", () => {
      // Arrange
      service.queueForRetry("evidence-1", mockSaveRequest, "Error 1");
      service.queueForRetry("evidence-2", mockSaveRequest, "Error 2");

      // Act
      const entries = service.getPendingEntries();

      // Assert
      expect(entries).toHaveLength(2);
      expect(entries[0].topicEvidenceId).toBe("evidence-1");
      expect(entries[1].topicEvidenceId).toBe("evidence-2");
    });
  });

  // ==================== getPermanentlyFailedEntries ====================

  describe("getPermanentlyFailedEntries", () => {
    it("should return empty array when no permanently failed entries", () => {
      // Act
      const entries = service.getPermanentlyFailedEntries();

      // Assert
      expect(entries).toEqual([]);
    });

    it("should return all permanently failed entries", async () => {
      // Arrange
      service.queueForRetry("evidence-1", mockSaveRequest, "Error 1");
      service.queueForRetry("evidence-2", mockSaveRequest, "Error 2");
      mockFacade.evidenceSave.mockRejectedValue(new Error("Failed"));

      // Act - retry 3 times to trigger permanent failure
      await service.processRetryQueue();
      await service.processRetryQueue();
      await service.processRetryQueue();

      const entries = service.getPermanentlyFailedEntries();

      // Assert
      expect(entries).toHaveLength(2);
      expect(entries[0].topicEvidenceId).toBe("evidence-1");
      expect(entries[1].topicEvidenceId).toBe("evidence-2");
    });
  });

  // ==================== triggerRetry ====================

  describe("triggerRetry", () => {
    it("should manually trigger retry process", async () => {
      // Arrange
      service.queueForRetry("evidence-1", mockSaveRequest, "Error");
      mockFacade.evidenceSave.mockResolvedValue(undefined);

      // Act
      await service.triggerRetry();

      // Assert
      expect(mockFacade.evidenceSave).toHaveBeenCalled();
      const stats = service.getStats();
      expect(stats.successCount).toBe(1);
    });
  });

  // ==================== clearPermanentlyFailed ====================

  describe("clearPermanentlyFailed", () => {
    it("should clear all permanently failed entries", async () => {
      // Arrange
      service.queueForRetry("evidence-1", mockSaveRequest, "Error");
      mockFacade.evidenceSave.mockRejectedValue(new Error("Failed"));

      // Create permanent failure
      await service.processRetryQueue();
      await service.processRetryQueue();
      await service.processRetryQueue();

      expect(service.getStats().permanentlyFailedCount).toBe(1);

      // Act
      service.clearPermanentlyFailed();

      // Assert
      const stats = service.getStats();
      expect(stats.permanentlyFailedCount).toBe(0);
      expect(service.getPermanentlyFailedEntries()).toEqual([]);
    });

    it("should not affect pending entries", async () => {
      // Arrange - create one entry that stays pending and one that permanently fails
      service.queueForRetry("pending-1", mockSaveRequest, "Error");
      service.queueForRetry("fail-1", mockSaveRequest, "Error");

      // Set up mock: fail all attempts for both, but we'll only run 3 batches which processes both 3 times each
      mockFacade.evidenceSave.mockRejectedValue(new Error("Always fail"));

      // Run 3 batches - both entries will fail 3 times and become permanently failed
      await service.processRetryQueue();
      await service.processRetryQueue();
      await service.processRetryQueue();

      // Verify both are permanently failed
      expect(service.getStats().permanentlyFailedCount).toBe(2);
      expect(service.getStats().pendingCount).toBe(0);

      // Now add a new pending entry
      service.queueForRetry("new-pending", mockSaveRequest, "Error");
      expect(service.getStats().pendingCount).toBe(1);

      // Act - clear permanently failed
      service.clearPermanentlyFailed();

      // Assert - only the new pending entry should remain
      const stats = service.getStats();
      expect(stats.pendingCount).toBe(1); // new-pending still there
      expect(stats.permanentlyFailedCount).toBe(0); // cleared
      expect(service.getPendingEntries()[0].topicEvidenceId).toBe(
        "new-pending",
      );
    });
  });

  // ==================== Module Lifecycle ====================

  describe("onModuleDestroy", () => {
    it("should clear interval on module destroy", () => {
      // Arrange
      const clearIntervalSpy = jest.spyOn(global, "clearInterval");

      // Act
      service.onModuleDestroy();

      // Assert
      expect(clearIntervalSpy).toHaveBeenCalled();
    });

    it("should handle multiple destroy calls", () => {
      // Act & Assert - should not throw
      service.onModuleDestroy();
      service.onModuleDestroy();
    });
  });

  // ==================== Integration Scenario ====================

  describe("Integration Scenario: Retry Success After Temporary Failure", () => {
    it("should successfully retry after temporary network issues", async () => {
      // Arrange
      service.queueForRetry(
        mockTopicEvidenceId,
        mockSaveRequest,
        "Network timeout",
      );

      // First two attempts fail
      mockFacade.evidenceSave
        .mockRejectedValueOnce(new Error("Network timeout"))
        .mockRejectedValueOnce(new Error("Connection refused"))
        .mockResolvedValueOnce(undefined); // Third attempt succeeds

      // Act
      await service.processRetryQueue(); // Attempt 1
      expect(service.getStats().pendingCount).toBe(1);

      await service.processRetryQueue(); // Attempt 2
      expect(service.getStats().pendingCount).toBe(1);

      await service.processRetryQueue(); // Attempt 3 - success
      const stats = service.getStats();

      // Assert
      expect(stats.pendingCount).toBe(0);
      expect(stats.successCount).toBe(1);
      expect(stats.failedCount).toBe(0);
    });
  });

  describe("Integration Scenario: Permanent Failure After Max Retries", () => {
    it("should permanently fail after max retries exhausted", async () => {
      // Arrange
      service.queueForRetry(
        mockTopicEvidenceId,
        mockSaveRequest,
        "Database locked",
      );

      mockFacade.evidenceSave.mockRejectedValue(new Error("Database locked"));

      // Act
      await service.processRetryQueue(); // Attempt 1
      await service.processRetryQueue(); // Attempt 2
      await service.processRetryQueue(); // Attempt 3 - permanent failure

      const stats = service.getStats();
      const permanentlyFailed = service.getPermanentlyFailedEntries();

      // Assert
      expect(stats.pendingCount).toBe(0);
      expect(stats.successCount).toBe(0);
      expect(stats.failedCount).toBe(1);
      expect(stats.permanentlyFailedCount).toBe(1);

      expect(permanentlyFailed[0].retryCount).toBe(3);
      expect(permanentlyFailed[0].lastError).toBe("Database locked");
    });
  });

  describe("Integration Scenario: Queue Capacity Management", () => {
    it("should handle queue overflow gracefully", () => {
      // Arrange - add entries up to max capacity
      for (let i = 0; i < 1001; i++) {
        service.queueForRetry(`evidence-${i}`, mockSaveRequest, `Error ${i}`);
      }

      // Act
      const stats = service.getStats();
      const pendingEntries = service.getPendingEntries();

      // Assert
      expect(stats.pendingCount).toBe(1000); // Max capacity
      expect(pendingEntries[0].topicEvidenceId).toBe("evidence-1"); // First was dropped
      expect(pendingEntries[pendingEntries.length - 1].topicEvidenceId).toBe(
        "evidence-1000",
      );
    });
  });
});
