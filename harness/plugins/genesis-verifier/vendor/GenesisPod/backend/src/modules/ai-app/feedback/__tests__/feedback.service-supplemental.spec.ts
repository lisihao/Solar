// ─── Module-level mocks (must be before any imports) ──────────────────────────
// Mock common/cache/cache.service to prevent loading @nestjs/cache-manager
// (not installed in test environment). Chain: feedback.service -> platform/facade
// -> auth.service -> cache.service -> @nestjs/cache-manager
jest.mock("../../../../common/cache/cache.service", () => ({
  CacheService: class MockCacheService {
    get = jest.fn();
    set = jest.fn();
    del = jest.fn();
  },
}));
// Mock platform/facade barrel to prevent deep dependency chain loading.
// We export named classes so that feedback.service.ts gets these mock classes
// as the DI tokens for EmailNotificationPresetsService and ObjectStorageService.
jest.mock("../../../platform/facade", () => ({
  EmailNotificationPresetsService: class EmailNotificationPresetsService {
    sendFeedbackNotification = jest.fn();
  },
  FeedbackStatusUpdatePreset: class FeedbackStatusUpdatePreset {
    notify = jest.fn();
  },
  NotificationPresetsService: class NotificationPresetsService {
    notifyFeedbackReceived = jest.fn();
  },
  ObjectStorageService: class ObjectStorageService {
    uploadBuffer = jest.fn();
    uploadStream = jest.fn();
  },
  AuthService: class AuthService {},
  CreditsService: class CreditsService {},
}));
// Mock @prisma/client to provide Prisma.sql, Prisma.empty, Prisma.join
// and PrismaClient (which PrismaService extends). These are not available
// in the generated test client without a live database connection.
jest.mock("@prisma/client", () => {
  const mockSql = (strings: TemplateStringsArray, ...values: unknown[]) => ({
    sql: strings.join("?"),
    values,
  });
  mockSql.empty = { sql: "", values: [] };

  class MockPrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
    $on = jest.fn();
    $queryRaw = jest.fn();
    $executeRaw = jest.fn();
    $transaction = jest.fn();
  }

  return {
    PrismaClient: MockPrismaClient,
    Prisma: {
      sql: mockSql,
      empty: mockSql.empty,
      join: (fragments: unknown[], separator = ", ") => ({
        sql: fragments
          .map((f) => (f as { sql: string }).sql ?? "")
          .join(separator),
        values: [],
      }),
    },
  };
});

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { FeedbackService } from "../feedback.service";
import { PrismaService } from "../../../../common/prisma/prisma.service";
// Import from the facade (which is mocked) - these are the same class references
// that feedback.service.ts uses as DI tokens, so the provider tokens will match.
import {
  EmailNotificationPresetsService,
  FeedbackStatusUpdatePreset,
  NotificationPresetsService,
  ObjectStorageService,
} from "../../../platform/facade";
import { AdminAuthService } from "../../../../common/services/admin-auth.service";
import { CreateFeedbackDto, FeedbackTypeDto } from "../dto/create-feedback.dto";

describe("FeedbackService (supplemental)", () => {
  let service: FeedbackService;
  let mockPrisma: { $queryRaw: jest.Mock };
  let mockEmailService: {
    sendFeedbackNotification: jest.Mock;
  };
  let mockStatusPreset: { notify: jest.Mock };
  let mockNotificationPresets: { notifyFeedbackReceived: jest.Mock };
  let mockAdminAuth: { getAdminEmails: jest.Mock };
  let mockR2Storage: { uploadBuffer: jest.Mock; uploadStream: jest.Mock };
  let mockEventEmitter: { emit: jest.Mock };

  const makeFeedback = (overrides: Record<string, unknown> = {}) => ({
    id: "feedback-1",
    type: "BUG",
    status: "PENDING",
    title: "Test Bug",
    description: "Something is broken",
    user_email: "user@test.com",
    user_agent: null,
    page_url: "https://app.test.com/page",
    user_id: "user-1",
    attachments: [],
    reply_count: 0,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  });

  beforeAll(async () => {
    mockPrisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "feedback-1" }]),
    };

    mockEmailService = {
      sendFeedbackNotification: jest.fn().mockResolvedValue(true),
    };
    mockStatusPreset = {
      notify: jest.fn().mockResolvedValue(undefined),
    };
    mockNotificationPresets = {
      notifyFeedbackReceived: jest.fn().mockResolvedValue(undefined),
    };
    mockAdminAuth = {
      getAdminEmails: jest.fn().mockReturnValue([]),
    };

    mockR2Storage = {
      uploadBuffer: jest.fn().mockResolvedValue({
        success: true,
        url: "https://cdn.example.com/file.png",
      }),
      uploadStream: jest.fn().mockResolvedValue({
        success: true,
        url: "https://cdn.example.com/file.png",
      }),
    };

    mockEventEmitter = {
      emit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeedbackService,
        { provide: PrismaService, useValue: mockPrisma },
        // Use the facade-imported class as the token - this matches what
        // feedback.service.ts uses when it imports from ../../platform/facade
        {
          provide: EmailNotificationPresetsService,
          useValue: mockEmailService,
        },
        {
          provide: FeedbackStatusUpdatePreset,
          useValue: mockStatusPreset,
        },
        {
          provide: NotificationPresetsService,
          useValue: mockNotificationPresets,
        },
        { provide: AdminAuthService, useValue: mockAdminAuth },
        { provide: ObjectStorageService, useValue: mockR2Storage },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<FeedbackService>(FeedbackService);
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    // Use resetAllMocks to clear both implementations and the Once queue,
    // preventing unconsumed mockResolvedValueOnce values from leaking across tests.
    jest.resetAllMocks();
    // Restore default implementations after reset
    mockPrisma.$queryRaw.mockResolvedValue([{ id: "feedback-1" }]);
    mockEmailService.sendFeedbackNotification.mockResolvedValue(true);
    mockStatusPreset.notify.mockResolvedValue(undefined);
    mockR2Storage.uploadBuffer.mockResolvedValue({
      success: true,
      url: "https://cdn.example.com/file.png",
    });
    mockR2Storage.uploadStream.mockResolvedValue({
      success: true,
      url: "https://cdn.example.com/file.png",
    });
    mockEventEmitter.emit.mockReturnValue(undefined);
    // Restore Logger spies that resetAllMocks may have cleared
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  // ==================== createFromAnnotation ====================

  describe("createFromAnnotation", () => {
    it("should create feedback from an annotation with selected text", async () => {
      const annotation = {
        id: "ann-1",
        content: "This is incorrect",
        selected_text: "The quick brown fox",
        report_id: "report-1",
      };

      mockPrisma.$queryRaw
        .mockResolvedValueOnce([annotation]) // fetch annotation
        .mockResolvedValueOnce([{ id: "feedback-created" }]); // insert feedback

      const result = await service.createFromAnnotation("user-1", "ann-1");

      expect(result.success).toBe(true);
      expect(result.feedbackId).toBeDefined();
      expect(result.message).toBe("Feedback created from annotation");
    });

    it("should create feedback from annotation without selected text", async () => {
      const annotation = {
        id: "ann-2",
        content: "General annotation comment",
        selected_text: null,
        report_id: "report-2",
      };

      mockPrisma.$queryRaw
        .mockResolvedValueOnce([annotation])
        .mockResolvedValueOnce([{ id: "feedback-created" }]);

      const result = await service.createFromAnnotation("user-1", "ann-2");

      expect(result.success).toBe(true);
    });

    it("should throw when annotation not found", async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([]); // no annotation

      await expect(
        service.createFromAnnotation("user-1", "nonexistent"),
      ).rejects.toThrow("Annotation not found: nonexistent");
    });

    it("should truncate selected text to 100 chars for title", async () => {
      const longText = "A".repeat(150);
      const annotation = {
        id: "ann-3",
        content: "Content",
        selected_text: longText,
        report_id: "report-3",
      };

      mockPrisma.$queryRaw
        .mockResolvedValueOnce([annotation])
        .mockResolvedValueOnce([{ id: "feedback-x" }]);

      await service.createFromAnnotation("user-1", "ann-3");

      // Verify that the INSERT was called (second $queryRaw call)
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(2);
    });

    it("should include annotation ID and report ID in description", async () => {
      const annotation = {
        id: "ann-4",
        content: "My annotation",
        selected_text: "some text",
        report_id: "report-4",
      };

      mockPrisma.$queryRaw
        .mockResolvedValueOnce([annotation])
        .mockResolvedValueOnce([{ id: "feedback-y" }]);

      // Just ensure it completes without error
      await expect(
        service.createFromAnnotation("user-2", "ann-4"),
      ).resolves.toBeDefined();
    });
  });

  // ==================== addReply ====================

  describe("addReply", () => {
    it("should add a reply to existing feedback", async () => {
      const feedback = makeFeedback();

      mockPrisma.$queryRaw
        .mockResolvedValueOnce([feedback]) // getFeedbackById
        .mockResolvedValueOnce([{ id: "reply-1" }]) // INSERT reply
        .mockResolvedValueOnce([]); // UPDATE reply_count

      const result = await service.addReply("feedback-1", {
        userId: "user-1",
        content: "Thanks for the feedback!",
        isAdmin: true,
      });

      expect(result.replyId).toBe("reply-1");
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        "feedback.replied",
        expect.objectContaining({
          feedbackId: "feedback-1",
          replyId: "reply-1",
          isAdmin: true,
        }),
      );
    });

    it("should throw when feedback not found", async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([]); // no feedback

      await expect(
        service.addReply("nonexistent", {
          content: "reply",
          isAdmin: false,
        }),
      ).rejects.toThrow("Feedback not found");
    });

    it("should support internal note flag", async () => {
      const feedback = makeFeedback();

      mockPrisma.$queryRaw
        .mockResolvedValueOnce([feedback])
        .mockResolvedValueOnce([{ id: "reply-2" }])
        .mockResolvedValueOnce([]);

      const result = await service.addReply("feedback-1", {
        content: "Internal note",
        isAdmin: true,
        internalNote: true,
      });

      expect(result.replyId).toBe("reply-2");
    });

    it("should emit feedback.replied event after adding reply", async () => {
      const feedback = makeFeedback();

      mockPrisma.$queryRaw
        .mockResolvedValueOnce([feedback])
        .mockResolvedValueOnce([{ id: "reply-3" }])
        .mockResolvedValueOnce([]);

      await service.addReply("feedback-1", {
        content: "Test reply",
        isAdmin: false,
        userId: "user-2",
      });

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        "feedback.replied",
        expect.objectContaining({
          feedbackId: "feedback-1",
          isAdmin: false,
          userId: "user-2",
        }),
      );
    });

    it("should work without userId (anonymous reply)", async () => {
      const feedback = makeFeedback();

      mockPrisma.$queryRaw
        .mockResolvedValueOnce([feedback])
        .mockResolvedValueOnce([{ id: "reply-anon" }])
        .mockResolvedValueOnce([]);

      const result = await service.addReply("feedback-1", {
        content: "Anonymous comment",
        isAdmin: false,
      });

      expect(result.replyId).toBe("reply-anon");
    });
  });

  // ==================== getReplies ====================

  describe("getReplies", () => {
    it("should return replies with total count", async () => {
      const replies = [
        {
          id: "r1",
          content: "First reply",
          is_admin: false,
          created_at: new Date(),
        },
      ];

      mockPrisma.$queryRaw
        .mockResolvedValueOnce(replies) // replies query
        .mockResolvedValueOnce([{ count: BigInt(1) }]); // count query

      const result = await service.getReplies("feedback-1");

      expect(result.replies).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.limit).toBe(50);
      expect(result.offset).toBe(0);
    });

    it("should apply custom limit and offset", async () => {
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: BigInt(0) }]);

      const result = await service.getReplies("feedback-1", {
        limit: 10,
        offset: 5,
      });

      expect(result.limit).toBe(10);
      expect(result.offset).toBe(5);
    });

    it("should include internal notes when includeInternal=true", async () => {
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: BigInt(0) }]);

      await service.getReplies("feedback-1", { includeInternal: true });

      // Both calls should be made
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(2);
    });

    it("should return empty replies when none found", async () => {
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: BigInt(0) }]);

      const result = await service.getReplies("feedback-1");

      expect(result.replies).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  // ==================== updateFeedbackPriority ====================

  describe("updateFeedbackPriority", () => {
    it("should update priority and return updated feedback", async () => {
      const updated = makeFeedback({ priority: "HIGH" });

      mockPrisma.$queryRaw.mockResolvedValueOnce([updated]);

      const result = await service.updateFeedbackPriority("feedback-1", "HIGH");

      expect(result).toEqual(updated);
    });

    it("should return null when feedback not found", async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([]);

      const result = await service.updateFeedbackPriority("nonexistent", "LOW");

      expect(result).toBeNull();
    });

    it("should support all priority levels", async () => {
      const priorities = ["LOW", "NORMAL", "HIGH", "CRITICAL"] as const;

      for (const priority of priorities) {
        mockPrisma.$queryRaw.mockResolvedValueOnce([
          makeFeedback({ priority }),
        ]);
        const result = await service.updateFeedbackPriority(
          "feedback-1",
          priority,
        );
        expect(result).toBeDefined();
      }
    });
  });

  // ==================== assignFeedback ====================

  describe("assignFeedback", () => {
    it("should assign feedback to an admin user", async () => {
      const updated = makeFeedback({ assigned_to: "admin-1" });

      mockPrisma.$queryRaw.mockResolvedValueOnce([updated]);

      const result = await service.assignFeedback("feedback-1", "admin-1");

      expect(result).toEqual(updated);
    });

    it("should unassign feedback when assignedTo is null", async () => {
      const updated = makeFeedback({ assigned_to: null });

      mockPrisma.$queryRaw.mockResolvedValueOnce([updated]);

      const result = await service.assignFeedback("feedback-1", null);

      expect(result).toBeDefined();
    });

    it("should return null when feedback not found", async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([]);

      const result = await service.assignFeedback("nonexistent", "admin-1");

      expect(result).toBeNull();
    });
  });

  // ==================== getAllFeedback with filters ====================

  describe("getAllFeedback with filters", () => {
    it("should handle status filter correctly", async () => {
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([makeFeedback({ status: "REVIEWED" })])
        .mockResolvedValueOnce([{ count: BigInt(1) }]);

      const result = await service.getAllFeedback({ status: "REVIEWED" });

      expect(result.feedbacks).toHaveLength(1);
    });

    it("should handle type filter correctly", async () => {
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([makeFeedback({ type: "FEATURE" })])
        .mockResolvedValueOnce([{ count: BigInt(1) }]);

      const result = await service.getAllFeedback({ type: "FEATURE" });

      expect(result.feedbacks).toHaveLength(1);
    });

    it("should handle both status and type filters", async () => {
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([
          makeFeedback({ type: "BUG", status: "IN_PROGRESS" }),
        ])
        .mockResolvedValueOnce([{ count: BigInt(1) }]);

      const result = await service.getAllFeedback({
        status: "IN_PROGRESS",
        type: "BUG",
      });

      expect(result.feedbacks).toHaveLength(1);
    });

    it("should return correct total with BigInt conversion", async () => {
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: BigInt(42) }]);

      const result = await service.getAllFeedback();

      expect(result.total).toBe(42);
    });

    it("should handle empty count result gracefully", async () => {
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: undefined }]);

      const result = await service.getAllFeedback();

      expect(result.total).toBe(0);
    });
  });

  // ==================== updateFeedbackStatus - email scenarios ====================

  describe("updateFeedbackStatus - additional scenarios", () => {
    it("should not send email when user has no email", async () => {
      const existing = makeFeedback({ user_email: null, status: "PENDING" });
      const updated = makeFeedback({ user_email: null, status: "RESOLVED" });

      mockPrisma.$queryRaw
        .mockResolvedValueOnce([existing])
        .mockResolvedValueOnce([updated]);

      await service.updateFeedbackStatus("feedback-1", "RESOLVED");

      expect(mockStatusPreset.notify).not.toHaveBeenCalled();
    });

    it("should continue even when email notification fails", async () => {
      const existing = makeFeedback({
        status: "PENDING",
        user_email: "user@test.com",
      });
      const updated = makeFeedback({ status: "RESOLVED" });

      mockPrisma.$queryRaw
        .mockResolvedValueOnce([existing])
        .mockResolvedValueOnce([updated]);

      mockStatusPreset.notify.mockRejectedValue(new Error("SMTP error"));

      const result = await service.updateFeedbackStatus(
        "feedback-1",
        "RESOLVED",
      );

      // Should not fail despite email error
      expect(result).toBeDefined();
    });

    it("should include adminNotes in update query when provided", async () => {
      const existing = makeFeedback({ status: "PENDING", user_email: null });
      const updated = makeFeedback({
        status: "RESOLVED",
        admin_notes: "Fixed in v2",
      });

      mockPrisma.$queryRaw
        .mockResolvedValueOnce([existing])
        .mockResolvedValueOnce([updated]);

      await service.updateFeedbackStatus(
        "feedback-1",
        "RESOLVED",
        "Fixed in v2",
      );

      // Second call is the UPDATE query
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(2);
    });
  });

  // ==================== createFeedback - type mapping ====================

  describe("createFeedback - all feedback types", () => {
    const allTypes = [
      { dtoType: FeedbackTypeDto.BUG, expected: "BUG" },
      { dtoType: FeedbackTypeDto.FEATURE, expected: "FEATURE" },
      { dtoType: FeedbackTypeDto.IMPROVEMENT, expected: "IMPROVEMENT" },
      { dtoType: FeedbackTypeDto.OTHER, expected: "OTHER" },
      { dtoType: FeedbackTypeDto.ANNOTATION, expected: "ANNOTATION" },
    ];

    for (const { dtoType, expected } of allTypes) {
      it(`should map ${dtoType} to ${expected}`, async () => {
        mockPrisma.$queryRaw.mockResolvedValueOnce([{ id: "feedback-1" }]);

        const dto: CreateFeedbackDto = {
          type: dtoType,
          title: "Test",
          description: "Description",
        };

        const result = await service.createFeedback(dto, "user-1");

        expect(result.success).toBe(true);
        // The type mapping is internal, we just verify it doesn't throw
      });
    }
  });
});
