import { Test, TestingModule } from "@nestjs/testing";
import { WebhookDispatcherService } from "../webhook-dispatcher.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { WebhookEventType, WebhookDeliveryStatus } from "@prisma/client";
import { Logger } from "@nestjs/common";

// Mock global fetch
global.fetch = jest.fn();

describe("WebhookDispatcherService", () => {
  let service: WebhookDispatcherService;
  let prismaService: jest.Mocked<PrismaService>;

  const mockSubscription = {
    id: "sub-123",
    userId: "user-123",
    name: "Test Webhook",
    description: "Test webhook subscription",
    url: "https://example.com/webhook",
    secret: "whsec_test123",
    events: [WebhookEventType.TOPIC_CREATED, WebhookEventType.MESSAGE_CREATED],
    topicIds: [],
    isActive: true,
    retryCount: 3,
    timeoutMs: 30000,
    failureCount: 0,
    lastFailureAt: null,
    disabledReason: null,
    batchSize: 10,
    batchDelayMs: 1000,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockDelivery = {
    id: "delivery-123",
    subscriptionId: "sub-123",
    eventType: WebhookEventType.TOPIC_CREATED,
    eventId: "evt-123",
    payload: {
      eventId: "evt-123",
      eventType: WebhookEventType.TOPIC_CREATED,
      timestamp: new Date().toISOString(),
      data: { topicId: "topic-123" },
    },
    status: WebhookDeliveryStatus.PENDING,
    attemptCount: 0,
    responseStatus: null,
    responseBody: null,
    responseTimeMs: null,
    errorMessage: null,
    nextRetryAt: null,
    deliveredAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const mockPrismaService = {
      $queryRaw: jest.fn(),
      webhookSubscription: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      webhookDelivery: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookDispatcherService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<WebhookDispatcherService>(WebhookDispatcherService);
    prismaService = module.get(PrismaService);

    // Spy on logger
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();

    // Clear all mocks
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("onModuleInit", () => {
    it("should check table existence and start retry processor", async () => {
      // Arrange
      (prismaService.$queryRaw as jest.Mock).mockResolvedValue([]);

      // Act
      await service.onModuleInit();

      // Assert
      expect(prismaService.$queryRaw).toHaveBeenCalledWith(
        expect.arrayContaining([expect.stringContaining("webhook_deliveries")]),
      );
    });

    it("should handle missing tables gracefully", async () => {
      // Arrange
      (prismaService.$queryRaw as jest.Mock).mockRejectedValue(
        new Error("Table not found"),
      );

      // Act
      await service.onModuleInit();

      // Assert
      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        expect.stringContaining("Webhook tables not found"),
      );
    });
  });

  describe("dispatch", () => {
    it("should dispatch webhook to matching subscriptions", async () => {
      // Arrange
      (
        prismaService.webhookSubscription.findMany as jest.Mock
      ).mockResolvedValue([mockSubscription]);
      (prismaService.webhookDelivery.create as jest.Mock).mockResolvedValue(
        mockDelivery,
      );
      (prismaService.webhookDelivery.findUnique as jest.Mock).mockResolvedValue(
        mockDelivery,
      );
      (prismaService.webhookDelivery.update as jest.Mock).mockResolvedValue({
        ...mockDelivery,
        attemptCount: 1,
      });
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue("OK"),
      });

      // Act
      await service.dispatch({
        type: WebhookEventType.TOPIC_CREATED,
        topicId: "topic-123",
        data: { topicId: "topic-123", userId: "user-123", name: "Test Topic" },
      });

      // Assert
      expect(prismaService.webhookSubscription.findMany).toHaveBeenCalledWith({
        where: {
          isActive: true,
          events: { has: WebhookEventType.TOPIC_CREATED },
        },
      });
      expect(prismaService.webhookDelivery.create).toHaveBeenCalled();
      expect(global.fetch).toHaveBeenCalledWith(
        mockSubscription.url,
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            "X-Webhook-Signature": expect.any(String),
            "X-Webhook-Event": WebhookEventType.TOPIC_CREATED,
          }),
        }),
      );
    });

    it("should not dispatch if no matching subscriptions found", async () => {
      // Arrange
      (
        prismaService.webhookSubscription.findMany as jest.Mock
      ).mockResolvedValue([]);

      // Act
      await service.dispatch({
        type: WebhookEventType.TOPIC_CREATED,
        topicId: "topic-123",
        data: { topicId: "topic-123" },
      });

      // Assert
      expect(prismaService.webhookDelivery.create).not.toHaveBeenCalled();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("should filter subscriptions by topicId", async () => {
      // Arrange
      const subscriptionWithTopics = {
        ...mockSubscription,
        topicIds: ["topic-456"],
      };
      (
        prismaService.webhookSubscription.findMany as jest.Mock
      ).mockResolvedValue([subscriptionWithTopics]);

      // Act
      await service.dispatch({
        type: WebhookEventType.TOPIC_CREATED,
        topicId: "topic-123",
        data: { topicId: "topic-123" },
      });

      // Assert
      expect(prismaService.webhookDelivery.create).not.toHaveBeenCalled();
    });

    it("should dispatch to subscriptions with empty topicIds array", async () => {
      // Arrange
      (
        prismaService.webhookSubscription.findMany as jest.Mock
      ).mockResolvedValue([mockSubscription]);
      (prismaService.webhookDelivery.create as jest.Mock).mockResolvedValue(
        mockDelivery,
      );
      (prismaService.webhookDelivery.findUnique as jest.Mock).mockResolvedValue(
        mockDelivery,
      );
      (prismaService.webhookDelivery.update as jest.Mock).mockResolvedValue({
        ...mockDelivery,
        attemptCount: 1,
      });
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue("OK"),
      });

      // Act
      await service.dispatch({
        type: WebhookEventType.TOPIC_CREATED,
        topicId: "any-topic",
        data: { topicId: "any-topic" },
      });

      // Assert
      expect(prismaService.webhookDelivery.create).toHaveBeenCalled();
    });
  });

  describe("attemptDelivery", () => {
    it("should mark delivery as success on successful HTTP response", async () => {
      // Arrange
      (prismaService.webhookDelivery.findUnique as jest.Mock).mockResolvedValue(
        mockDelivery,
      );
      (prismaService.webhookDelivery.update as jest.Mock).mockResolvedValue({
        ...mockDelivery,
        status: WebhookDeliveryStatus.SUCCESS,
      });
      (prismaService.webhookSubscription.update as jest.Mock).mockResolvedValue(
        mockSubscription,
      );
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue("Success"),
      });

      // Act
      await service["attemptDelivery"](
        mockSubscription,
        mockDelivery.id,
        mockDelivery.payload as any,
      );

      // Assert
      expect(prismaService.webhookDelivery.update).toHaveBeenCalledWith({
        where: { id: mockDelivery.id },
        data: expect.objectContaining({
          status: WebhookDeliveryStatus.SUCCESS,
          responseStatus: 200,
        }),
      });
      expect(prismaService.webhookSubscription.update).toHaveBeenCalledWith({
        where: { id: mockSubscription.id },
        data: {
          failureCount: 0,
          lastFailureAt: null,
        },
      });
    });

    it("should schedule retry on failed delivery when retries remain", async () => {
      // Arrange
      (prismaService.webhookDelivery.findUnique as jest.Mock).mockResolvedValue(
        mockDelivery,
      );
      (prismaService.webhookDelivery.update as jest.Mock).mockResolvedValue({
        ...mockDelivery,
        attemptCount: 1,
        status: WebhookDeliveryStatus.RETRYING,
      });
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 500,
        text: jest.fn().mockResolvedValue("Internal Server Error"),
      });

      // Act
      await service["attemptDelivery"](
        mockSubscription,
        mockDelivery.id,
        mockDelivery.payload as any,
      );

      // Assert
      expect(prismaService.webhookDelivery.update).toHaveBeenCalledWith({
        where: { id: mockDelivery.id },
        data: expect.objectContaining({
          status: WebhookDeliveryStatus.RETRYING,
          nextRetryAt: expect.any(Date),
        }),
      });
    });

    it("should mark as failed when max retries exceeded", async () => {
      // Arrange
      const deliveryWithMaxAttempts = {
        ...mockDelivery,
        attemptCount: 3,
      };
      (prismaService.webhookDelivery.findUnique as jest.Mock).mockResolvedValue(
        deliveryWithMaxAttempts,
      );
      (prismaService.webhookDelivery.update as jest.Mock).mockResolvedValue({
        ...deliveryWithMaxAttempts,
        status: WebhookDeliveryStatus.FAILED,
      });
      (prismaService.webhookSubscription.update as jest.Mock).mockResolvedValue(
        {
          ...mockSubscription,
          failureCount: 1,
        },
      );
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 500,
        text: jest.fn().mockResolvedValue("Error"),
      });

      // Act
      await service["attemptDelivery"](
        mockSubscription,
        deliveryWithMaxAttempts.id,
        mockDelivery.payload as any,
      );

      // Assert
      expect(prismaService.webhookDelivery.update).toHaveBeenCalledWith({
        where: { id: deliveryWithMaxAttempts.id },
        data: expect.objectContaining({
          status: WebhookDeliveryStatus.FAILED,
        }),
      });
    });

    it("should handle network errors gracefully", async () => {
      // Arrange
      (prismaService.webhookDelivery.findUnique as jest.Mock).mockResolvedValue(
        mockDelivery,
      );
      (prismaService.webhookDelivery.update as jest.Mock).mockResolvedValue({
        ...mockDelivery,
        attemptCount: 1,
      });
      (global.fetch as jest.Mock).mockRejectedValue(new Error("Network error"));

      // Act
      await service["attemptDelivery"](
        mockSubscription,
        mockDelivery.id,
        mockDelivery.payload as any,
      );

      // Assert
      expect(prismaService.webhookDelivery.update).toHaveBeenCalledWith({
        where: { id: mockDelivery.id },
        data: expect.objectContaining({
          status: WebhookDeliveryStatus.RETRYING,
          errorMessage: "Network error",
        }),
      });
    });
  });

  describe("sendWebhook", () => {
    it("should send webhook with correct headers and signature", async () => {
      // Arrange
      const payload = {
        eventId: "evt-123",
        eventType: WebhookEventType.TOPIC_CREATED,
        timestamp: new Date().toISOString(),
        data: { test: true },
      };
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue("OK"),
      });

      // Act
      const result = await service["sendWebhook"](
        mockSubscription,
        payload as any,
      );

      // Assert
      expect(global.fetch).toHaveBeenCalledWith(
        mockSubscription.url,
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            "X-Webhook-Signature": expect.stringContaining("t="),
            "X-Webhook-Event": payload.eventType,
            "X-Webhook-Delivery": payload.eventId,
          }),
          body: JSON.stringify(payload),
        }),
      );
      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
    });

    it("should handle HTTP error responses", async () => {
      // Arrange
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 404,
        text: jest.fn().mockResolvedValue("Not Found"),
      });

      // Act
      const result = await service["sendWebhook"](
        mockSubscription,
        mockDelivery.payload as any,
      );

      // Assert
      expect(result.success).toBe(false);
      expect(result.status).toBe(404);
      expect(result.error).toBe("HTTP 404");
    });

    it("should handle fetch timeout", async () => {
      // Arrange
      (global.fetch as jest.Mock).mockRejectedValue(new Error("Timeout"));

      // Act
      const result = await service["sendWebhook"](
        mockSubscription,
        mockDelivery.payload as any,
      );

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe("Timeout");
    });
  });

  describe("incrementSubscriptionFailures", () => {
    it("should disable subscription after 10 consecutive failures", async () => {
      // Arrange
      const failingSubscription = {
        ...mockSubscription,
        failureCount: 10,
      };
      (prismaService.webhookSubscription.update as jest.Mock)
        .mockResolvedValueOnce(failingSubscription)
        .mockResolvedValueOnce({
          ...failingSubscription,
          isActive: false,
          disabledReason: "Too many consecutive failures",
        });

      // Act
      await service["incrementSubscriptionFailures"](mockSubscription.id);

      // Assert
      expect(prismaService.webhookSubscription.update).toHaveBeenCalledTimes(2);
      expect(prismaService.webhookSubscription.update).toHaveBeenLastCalledWith(
        {
          where: { id: mockSubscription.id },
          data: {
            isActive: false,
            disabledReason: "Too many consecutive failures",
          },
        },
      );
      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        expect.stringContaining("disabled due to failures"),
      );
    });

    it("should not disable subscription before reaching 10 failures", async () => {
      // Arrange
      const partiallyFailingSubscription = {
        ...mockSubscription,
        failureCount: 5,
      };
      (prismaService.webhookSubscription.update as jest.Mock).mockResolvedValue(
        partiallyFailingSubscription,
      );

      // Act
      await service["incrementSubscriptionFailures"](mockSubscription.id);

      // Assert
      expect(prismaService.webhookSubscription.update).toHaveBeenCalledTimes(1);
    });
  });

  describe("processRetryQueue", () => {
    it("should process pending retries", async () => {
      // Arrange
      const pendingDelivery = {
        ...mockDelivery,
        status: WebhookDeliveryStatus.RETRYING,
        nextRetryAt: new Date(Date.now() - 1000),
        subscription: mockSubscription,
      };
      (prismaService.webhookDelivery.findMany as jest.Mock).mockResolvedValue([
        pendingDelivery,
      ]);
      (prismaService.webhookDelivery.findUnique as jest.Mock).mockResolvedValue(
        pendingDelivery,
      );
      (prismaService.webhookDelivery.update as jest.Mock).mockResolvedValue({
        ...pendingDelivery,
        attemptCount: 1,
      });
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue("OK"),
      });

      // Act
      await service["processRetryQueue"]();

      // Assert
      expect(prismaService.webhookDelivery.findMany).toHaveBeenCalledWith({
        where: {
          status: WebhookDeliveryStatus.RETRYING,
          nextRetryAt: { lte: expect.any(Date) },
        },
        include: { subscription: true },
        take: 100,
      });
    });

    it("should skip disabled subscriptions in retry queue", async () => {
      // Arrange
      const pendingDelivery = {
        ...mockDelivery,
        status: WebhookDeliveryStatus.RETRYING,
        nextRetryAt: new Date(Date.now() - 1000),
        subscription: { ...mockSubscription, isActive: false },
      };
      (prismaService.webhookDelivery.findMany as jest.Mock).mockResolvedValue([
        pendingDelivery,
      ]);
      (prismaService.webhookDelivery.update as jest.Mock).mockResolvedValue({
        ...pendingDelivery,
        status: WebhookDeliveryStatus.FAILED,
      });

      // Act
      await service["processRetryQueue"]();

      // Assert
      expect(prismaService.webhookDelivery.update).toHaveBeenCalledWith({
        where: { id: pendingDelivery.id },
        data: expect.objectContaining({
          status: WebhookDeliveryStatus.FAILED,
          errorMessage: "Subscription disabled",
        }),
      });
    });

    it("should handle errors in retry queue processing", async () => {
      // Arrange
      (prismaService.webhookDelivery.findMany as jest.Mock).mockRejectedValue(
        new Error("Database error"),
      );

      // Act
      await service["processRetryQueue"]();

      // Assert
      expect(Logger.prototype.error).toHaveBeenCalledWith(
        "Error processing retry queue",
        expect.any(Error),
      );
    });
  });

  describe("calculateNextRetry", () => {
    it("should use exponential backoff for retries", () => {
      // Act & Assert
      const retry1 = service["calculateNextRetry"](1);
      const retry2 = service["calculateNextRetry"](2);
      const retry3 = service["calculateNextRetry"](3);

      expect(retry1.getTime()).toBeGreaterThan(Date.now() + 55000); // ~1 minute
      expect(retry2.getTime()).toBeGreaterThan(Date.now() + 295000); // ~5 minutes
      expect(retry3.getTime()).toBeGreaterThan(Date.now() + 1795000); // ~30 minutes
    });

    it("should cap at maximum delay for high attempt counts", () => {
      // Act
      const retry10 = service["calculateNextRetry"](10);
      const retry20 = service["calculateNextRetry"](20);

      // Assert - should use max delay (6 hours = 21600 seconds)
      expect(retry10.getTime()).toBeLessThan(Date.now() + 22000000);
      expect(retry20.getTime()).toBeLessThan(Date.now() + 22000000);
    });
  });

  describe("event handlers", () => {
    beforeEach(() => {
      jest.spyOn(service, "dispatch").mockResolvedValue(undefined);
    });

    it("should handle topic.created event", async () => {
      // Arrange
      const payload = {
        topicId: "topic-123",
        userId: "user-123",
        name: "Test Topic",
      };

      // Act
      await service.handleTopicCreated(payload);

      // Assert
      expect(service.dispatch).toHaveBeenCalledWith({
        type: WebhookEventType.TOPIC_CREATED,
        topicId: payload.topicId,
        data: payload,
      });
    });

    it("should handle topic.updated event", async () => {
      // Arrange
      const payload = {
        topicId: "topic-123",
        changes: { name: "Updated Name" },
      };

      // Act
      await service.handleTopicUpdated(payload);

      // Assert
      expect(service.dispatch).toHaveBeenCalledWith({
        type: WebhookEventType.TOPIC_UPDATED,
        topicId: payload.topicId,
        data: payload,
      });
    });

    it("should handle message.created event", async () => {
      // Arrange
      const payload = {
        topicId: "topic-123",
        messageId: "msg-123",
        senderId: "user-123",
        content: "Hello",
      };

      // Act
      await service.handleMessageCreated(payload);

      // Assert
      expect(service.dispatch).toHaveBeenCalledWith({
        type: WebhookEventType.MESSAGE_CREATED,
        topicId: payload.topicId,
        data: payload,
      });
    });

    it("should handle ai.response.error event", async () => {
      // Arrange
      const payload = {
        topicId: "topic-123",
        aiMemberId: "ai-123",
        error: "Model timeout",
      };

      // Act
      await service.handleAIResponseError(payload);

      // Assert
      expect(service.dispatch).toHaveBeenCalledWith({
        type: WebhookEventType.AI_RESPONSE_ERROR,
        topicId: payload.topicId,
        data: payload,
      });
    });
  });
});
