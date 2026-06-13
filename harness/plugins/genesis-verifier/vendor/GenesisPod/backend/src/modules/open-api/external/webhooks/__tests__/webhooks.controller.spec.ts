// Module-level mocks to prevent transitive import failures in the test environment
jest.mock("cache-manager-ioredis-yet", () => ({
  redisStore: jest.fn(),
}));
jest.mock("@nestjs/cache-manager", () => ({
  CacheModule: {
    registerAsync: jest.fn().mockReturnValue({ module: class {} }),
  },
  CACHE_MANAGER: "CACHE_MANAGER",
  Cache: jest.fn(),
}));

import { Test, TestingModule } from "@nestjs/testing";
import {
  NotFoundException,
  ForbiddenException,
  ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { WebhooksController } from "../webhooks.controller";
import { WebhooksService } from "../webhooks.service";
import { JwtAuthGuard } from "../../../../../common/guards/jwt-auth.guard";
import { RateLimitGuard } from "../../../../../common/guards/rate-limit.guard";
import { CreateWebhookDto, UpdateWebhookDto } from "../dto";
import { WebhookEventType } from "@prisma/client";

// ---------------------------------------------------------------------------
// Mock service
// ---------------------------------------------------------------------------

const mockWebhooksService = {
  create: jest.fn(),
  findAll: jest.fn(),
  findOne: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  regenerateSecret: jest.fn(),
  getDeliveries: jest.fn(),
  testWebhook: jest.fn(),
};

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

function makeRequest(userId = "user-1") {
  return { user: { id: userId, email: "test@example.com" } };
}

const WEBHOOK_ID = "webhook-abc-123";

function makeWebhook(overrides: Record<string, unknown> = {}) {
  return {
    id: WEBHOOK_ID,
    userId: "user-1",
    name: "My Webhook",
    description: "Test webhook",
    url: "https://example.com/webhook",
    events: [WebhookEventType.TOPIC_CREATED, WebhookEventType.MESSAGE_CREATED],
    topicIds: [],
    isActive: true,
    failureCount: 0,
    lastFailureAt: null,
    disabledReason: null,
    retryCount: 3,
    timeoutMs: 30000,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeCreateDto(
  overrides: Partial<CreateWebhookDto> = {},
): CreateWebhookDto {
  return {
    name: "My Webhook",
    url: "https://example.com/webhook",
    events: [WebhookEventType.TOPIC_CREATED],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("WebhooksController", () => {
  let controller: WebhooksController;

  beforeEach(async () => {
    const mockJwtGuard = {
      canActivate: (_ctx: ExecutionContext) => true,
    };
    const mockRateLimitGuard = {
      canActivate: (_ctx: ExecutionContext) => true,
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebhooksController],
      providers: [
        { provide: WebhooksService, useValue: mockWebhooksService },
        // RateLimitGuard requires Reflector; provide a real one so the override works cleanly
        Reflector,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockJwtGuard)
      .overrideGuard(RateLimitGuard)
      .useValue(mockRateLimitGuard)
      .compile();

    controller = module.get<WebhooksController>(WebhooksController);

    jest.clearAllMocks();
  });

  // ==================== POST / (create) ====================

  describe("POST / (create)", () => {
    it("creates a webhook and returns it including the secret", async () => {
      const created = { ...makeWebhook(), secret: "whsec_abc123" };
      mockWebhooksService.create.mockResolvedValue(created);

      const result = await controller.create(makeRequest(), makeCreateDto());

      expect(result).toEqual(created);
      expect(result).toHaveProperty("secret");
      expect(mockWebhooksService.create).toHaveBeenCalledWith(
        "user-1",
        expect.objectContaining({ name: "My Webhook" }),
      );
    });

    it("creates webhook with optional topicIds and retryCount", async () => {
      const dto = makeCreateDto({ topicIds: ["topic-1"], retryCount: 5 });
      const created = { ...makeWebhook(), secret: "whsec_xyz789" };
      mockWebhooksService.create.mockResolvedValue(created);

      await controller.create(makeRequest(), dto);

      expect(mockWebhooksService.create).toHaveBeenCalledWith(
        "user-1",
        expect.objectContaining({ topicIds: ["topic-1"], retryCount: 5 }),
      );
    });

    it("propagates service errors on creation failure", async () => {
      mockWebhooksService.create.mockRejectedValue(
        new Error("Database write failed"),
      );

      await expect(
        controller.create(makeRequest(), makeCreateDto()),
      ).rejects.toThrow("Database write failed");
    });
  });

  // ==================== GET / (findAll) ====================

  describe("GET / (findAll)", () => {
    it("returns all webhooks for the authenticated user", async () => {
      const webhooks = [makeWebhook(), makeWebhook({ id: "webhook-def-456" })];
      mockWebhooksService.findAll.mockResolvedValue(webhooks);

      const result = await controller.findAll(makeRequest());

      expect(result).toHaveLength(2);
      expect(mockWebhooksService.findAll).toHaveBeenCalledWith("user-1");
    });

    it("returns an empty array when user has no webhooks", async () => {
      mockWebhooksService.findAll.mockResolvedValue([]);

      const result = await controller.findAll(makeRequest());

      expect(result).toEqual([]);
    });

    it("propagates service errors", async () => {
      mockWebhooksService.findAll.mockRejectedValue(new Error("DB timeout"));

      await expect(controller.findAll(makeRequest())).rejects.toThrow(
        "DB timeout",
      );
    });
  });

  // ==================== GET /:id (findOne) ====================

  describe("GET /:id (findOne)", () => {
    it("returns webhook details without the secret field", async () => {
      const webhook = makeWebhook();
      mockWebhooksService.findOne.mockResolvedValue(webhook);

      const result = await controller.findOne(makeRequest(), WEBHOOK_ID);

      expect(result).toEqual(webhook);
      expect(mockWebhooksService.findOne).toHaveBeenCalledWith(
        "user-1",
        WEBHOOK_ID,
      );
    });

    it("propagates NotFoundException when webhook does not exist", async () => {
      mockWebhooksService.findOne.mockRejectedValue(
        new NotFoundException("Webhook not found"),
      );

      await expect(
        controller.findOne(makeRequest(), "nonexistent-id"),
      ).rejects.toThrow(NotFoundException);
    });

    it("propagates ForbiddenException when user does not own the webhook", async () => {
      mockWebhooksService.findOne.mockRejectedValue(
        new ForbiddenException("Not authorized to access this webhook"),
      );

      await expect(
        controller.findOne(makeRequest("user-other"), WEBHOOK_ID),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ==================== PUT /:id (update) ====================

  describe("PUT /:id (update)", () => {
    const buildUpdateDto = (
      overrides: Partial<UpdateWebhookDto> = {},
    ): UpdateWebhookDto => ({
      name: "Updated Webhook",
      ...overrides,
    });

    it("updates webhook and returns updated record without secret", async () => {
      const updated = makeWebhook({ name: "Updated Webhook" });
      mockWebhooksService.update.mockResolvedValue(updated);

      const result = await controller.update(
        makeRequest(),
        WEBHOOK_ID,
        buildUpdateDto(),
      );

      expect(result).toEqual(updated);
      expect(mockWebhooksService.update).toHaveBeenCalledWith(
        "user-1",
        WEBHOOK_ID,
        expect.objectContaining({ name: "Updated Webhook" }),
      );
    });

    it("propagates NotFoundException when webhook does not exist", async () => {
      mockWebhooksService.update.mockRejectedValue(
        new NotFoundException("Webhook not found"),
      );

      await expect(
        controller.update(makeRequest(), "ghost-id", buildUpdateDto()),
      ).rejects.toThrow(NotFoundException);
    });

    it("propagates ForbiddenException when user does not own the webhook", async () => {
      mockWebhooksService.update.mockRejectedValue(
        new ForbiddenException("Not authorized to update this webhook"),
      );

      await expect(
        controller.update(
          makeRequest("user-other"),
          WEBHOOK_ID,
          buildUpdateDto(),
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ==================== DELETE /:id (delete) ====================

  describe("DELETE /:id (delete)", () => {
    it("deletes webhook and returns { success: true }", async () => {
      mockWebhooksService.delete.mockResolvedValue({ success: true });

      const result = await controller.delete(makeRequest(), WEBHOOK_ID);

      expect(result).toEqual({ success: true });
      expect(mockWebhooksService.delete).toHaveBeenCalledWith(
        "user-1",
        WEBHOOK_ID,
      );
    });

    it("propagates NotFoundException when webhook does not exist", async () => {
      mockWebhooksService.delete.mockRejectedValue(
        new NotFoundException("Webhook not found"),
      );

      await expect(
        controller.delete(makeRequest(), "nonexistent-id"),
      ).rejects.toThrow(NotFoundException);
    });

    it("propagates ForbiddenException when user does not own the webhook", async () => {
      mockWebhooksService.delete.mockRejectedValue(
        new ForbiddenException("Not authorized to delete this webhook"),
      );

      await expect(
        controller.delete(makeRequest("user-other"), WEBHOOK_ID),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ==================== POST /:id/regenerate-secret ====================

  describe("POST /:id/regenerate-secret (regenerateSecret)", () => {
    it("returns a new secret string", async () => {
      mockWebhooksService.regenerateSecret.mockResolvedValue({
        secret: "whsec_newkey456",
      });

      const result = await controller.regenerateSecret(
        makeRequest(),
        WEBHOOK_ID,
      );

      expect(result).toEqual({ secret: "whsec_newkey456" });
      expect(mockWebhooksService.regenerateSecret).toHaveBeenCalledWith(
        "user-1",
        WEBHOOK_ID,
      );
    });

    it("propagates NotFoundException when webhook does not exist", async () => {
      mockWebhooksService.regenerateSecret.mockRejectedValue(
        new NotFoundException("Webhook not found"),
      );

      await expect(
        controller.regenerateSecret(makeRequest(), "missing-id"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ==================== GET /:id/deliveries ====================

  describe("GET /:id/deliveries (getDeliveries)", () => {
    const mockDeliveries = [
      {
        id: "delivery-1",
        eventType: WebhookEventType.TOPIC_CREATED,
        status: "SUCCESS",
        attemptCount: 1,
        responseStatus: 200,
        createdAt: new Date(),
      },
    ];

    it("returns paginated delivery history with default limit", async () => {
      mockWebhooksService.getDeliveries.mockResolvedValue({
        deliveries: mockDeliveries,
        nextCursor: null,
      });

      const result = await controller.getDeliveries(
        makeRequest(),
        WEBHOOK_ID,
        undefined,
        undefined,
      );

      expect(result.deliveries).toHaveLength(1);
      expect(result.nextCursor).toBeNull();
      expect(mockWebhooksService.getDeliveries).toHaveBeenCalledWith(
        "user-1",
        WEBHOOK_ID,
        { limit: undefined, cursor: undefined },
      );
    });

    it("parses limit query param as integer and forwards cursor", async () => {
      mockWebhooksService.getDeliveries.mockResolvedValue({
        deliveries: mockDeliveries,
        nextCursor: "delivery-1",
      });

      await controller.getDeliveries(
        makeRequest(),
        WEBHOOK_ID,
        "10",
        "cursor-abc",
      );

      expect(mockWebhooksService.getDeliveries).toHaveBeenCalledWith(
        "user-1",
        WEBHOOK_ID,
        { limit: 10, cursor: "cursor-abc" },
      );
    });

    it("propagates NotFoundException when webhook does not exist", async () => {
      mockWebhooksService.getDeliveries.mockRejectedValue(
        new NotFoundException("Webhook not found"),
      );

      await expect(
        controller.getDeliveries(makeRequest(), "nonexistent-id"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ==================== POST /:id/test (testWebhook) ====================

  describe("POST /:id/test (testWebhook)", () => {
    it("returns successful test result", async () => {
      mockWebhooksService.testWebhook.mockResolvedValue({
        success: true,
        status: 200,
        responseTime: 123,
        responseBody: "OK",
      });

      const result = await controller.testWebhook(makeRequest(), WEBHOOK_ID);

      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
      expect(mockWebhooksService.testWebhook).toHaveBeenCalledWith(
        "user-1",
        WEBHOOK_ID,
      );
    });

    it("returns failed test result when remote endpoint is unreachable", async () => {
      mockWebhooksService.testWebhook.mockResolvedValue({
        success: false,
        error: "fetch failed",
      });

      const result = await controller.testWebhook(makeRequest(), WEBHOOK_ID);

      expect(result.success).toBe(false);
      expect(result).toHaveProperty("error");
    });

    it("propagates NotFoundException when webhook does not exist", async () => {
      mockWebhooksService.testWebhook.mockRejectedValue(
        new NotFoundException("Webhook not found"),
      );

      await expect(
        controller.testWebhook(makeRequest(), "nonexistent-id"),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
