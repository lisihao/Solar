/**
 * WebhooksService unit tests
 *
 * Covers:
 * - create – success (includes secret in response)
 * - findAll – returns list without secret
 * - findOne – not found, wrong owner, success (strips secret)
 * - update – not found, wrong owner, success; re-activate clears failureCount
 * - delete – not found, wrong owner, success
 * - regenerateSecret – not found, wrong owner, success
 * - getDeliveries – not found, wrong owner, pagination with cursor, hasMore logic
 * - testWebhook – not found, wrong owner, fetch success, fetch failure
 * - signPayload – format validation
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger, NotFoundException, ForbiddenException } from "@nestjs/common";
import { WebhookEventType } from "@prisma/client";
import { WebhooksService } from "../webhooks.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { CreateWebhookDto, UpdateWebhookDto } from "../dto";

// ─── fetch mock ───────────────────────────────────────────────────────────────

const mockFetch = jest.fn();
global.fetch = mockFetch;

// ─── helpers ─────────────────────────────────────────────────────────────────

const makeWebhook = (overrides: Record<string, unknown> = {}) => ({
  id: "wh-1",
  userId: "user-1",
  name: "Test Hook",
  description: "A test webhook",
  url: "https://example.com/hook",
  secret: "whsec_abc123",
  events: [WebhookEventType.TOPIC_CREATED],
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
});

// ─── tests ───────────────────────────────────────────────────────────────────

describe("WebhooksService", () => {
  let service: WebhooksService;
  let mockPrisma: {
    webhookSubscription: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    webhookDelivery: {
      findMany: jest.Mock;
    };
  };

  beforeEach(async () => {
    mockPrisma = {
      webhookSubscription: {
        create: jest.fn().mockResolvedValue(makeWebhook()),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue(makeWebhook()),
        delete: jest.fn().mockResolvedValue(makeWebhook()),
      },
      webhookDelivery: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhooksService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<WebhooksService>(WebhooksService);
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
    mockFetch.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // create
  // ──────────────────────────────────────────────────────────────────────────

  describe("create", () => {
    it("creates webhook and includes secret in response", async () => {
      const webhook = makeWebhook();
      mockPrisma.webhookSubscription.create.mockResolvedValue(webhook);

      const dto: CreateWebhookDto = {
        name: "My Hook",
        url: "https://example.com/hook",
        events: [WebhookEventType.TOPIC_CREATED],
      };

      const result = await service.create("user-1", dto);

      expect(result.secret).toBeDefined();
      expect(result.secret).toMatch(/^whsec_/);
    });

    it("uses defaults for retryCount and timeoutMs when not provided", async () => {
      mockPrisma.webhookSubscription.create.mockResolvedValue(makeWebhook());

      const dto: CreateWebhookDto = {
        name: "Hook",
        url: "https://example.com/hook",
        events: [WebhookEventType.MESSAGE_CREATED],
      };

      await service.create("user-1", dto);

      const createData =
        mockPrisma.webhookSubscription.create.mock.calls[0][0].data;
      expect(createData.retryCount).toBe(3);
      expect(createData.timeoutMs).toBe(30000);
    });

    it("uses provided retryCount and timeoutMs", async () => {
      mockPrisma.webhookSubscription.create.mockResolvedValue(makeWebhook());

      const dto: CreateWebhookDto = {
        name: "Hook",
        url: "https://example.com/hook",
        events: [],
        retryCount: 5,
        timeoutMs: 10000,
      };

      await service.create("user-1", dto);

      const createData =
        mockPrisma.webhookSubscription.create.mock.calls[0][0].data;
      expect(createData.retryCount).toBe(5);
      expect(createData.timeoutMs).toBe(10000);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // findAll
  // ──────────────────────────────────────────────────────────────────────────

  describe("findAll", () => {
    it("returns list of webhooks for user", async () => {
      mockPrisma.webhookSubscription.findMany.mockResolvedValue([
        makeWebhook({ id: "wh-1" }),
        makeWebhook({ id: "wh-2" }),
      ]);

      const result = await service.findAll("user-1");

      expect(result).toHaveLength(2);
    });

    it("queries with userId filter", async () => {
      await service.findAll("user-1");

      const callArgs = mockPrisma.webhookSubscription.findMany.mock.calls[0][0];
      expect(callArgs.where).toEqual({ userId: "user-1" });
    });

    it("returns empty array when user has no webhooks", async () => {
      mockPrisma.webhookSubscription.findMany.mockResolvedValue([]);

      const result = await service.findAll("user-1");
      expect(result).toEqual([]);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // findOne
  // ──────────────────────────────────────────────────────────────────────────

  describe("findOne", () => {
    it("throws NotFoundException when webhook not found", async () => {
      mockPrisma.webhookSubscription.findUnique.mockResolvedValue(null);

      await expect(service.findOne("user-1", "wh-1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws ForbiddenException when user is not owner", async () => {
      mockPrisma.webhookSubscription.findUnique.mockResolvedValue(
        makeWebhook({ userId: "other-user" }),
      );

      await expect(service.findOne("user-1", "wh-1")).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("returns webhook without secret when user is owner", async () => {
      mockPrisma.webhookSubscription.findUnique.mockResolvedValue(
        makeWebhook({ userId: "user-1" }),
      );

      const result = await service.findOne("user-1", "wh-1");

      expect(result).not.toHaveProperty("secret");
      expect(result.id).toBe("wh-1");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // update
  // ──────────────────────────────────────────────────────────────────────────

  describe("update", () => {
    it("throws NotFoundException when webhook not found", async () => {
      mockPrisma.webhookSubscription.findUnique.mockResolvedValue(null);

      await expect(service.update("user-1", "wh-1", {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws ForbiddenException when user is not owner", async () => {
      mockPrisma.webhookSubscription.findUnique.mockResolvedValue(
        makeWebhook({ userId: "other-user" }),
      );

      await expect(service.update("user-1", "wh-1", {})).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("updates webhook and returns result without secret", async () => {
      mockPrisma.webhookSubscription.findUnique.mockResolvedValue(
        makeWebhook({ userId: "user-1" }),
      );
      mockPrisma.webhookSubscription.update.mockResolvedValue(
        makeWebhook({ userId: "user-1", name: "Updated" }),
      );

      const dto: UpdateWebhookDto = { name: "Updated" };
      const result = await service.update("user-1", "wh-1", dto);

      expect(result).not.toHaveProperty("secret");
      expect(mockPrisma.webhookSubscription.update).toHaveBeenCalled();
    });

    it("clears failureCount and disabledReason when re-activating", async () => {
      mockPrisma.webhookSubscription.findUnique.mockResolvedValue(
        makeWebhook({ userId: "user-1", isActive: false, failureCount: 5 }),
      );
      mockPrisma.webhookSubscription.update.mockResolvedValue(
        makeWebhook({ userId: "user-1", isActive: true, failureCount: 0 }),
      );

      const dto: UpdateWebhookDto = { isActive: true };
      await service.update("user-1", "wh-1", dto);

      const updateData =
        mockPrisma.webhookSubscription.update.mock.calls[0][0].data;
      expect(updateData.failureCount).toBe(0);
      expect(updateData.disabledReason).toBeNull();
    });

    it("does not clear failureCount when isActive is false", async () => {
      mockPrisma.webhookSubscription.findUnique.mockResolvedValue(
        makeWebhook({ userId: "user-1" }),
      );
      mockPrisma.webhookSubscription.update.mockResolvedValue(makeWebhook());

      await service.update("user-1", "wh-1", { isActive: false });

      const updateData =
        mockPrisma.webhookSubscription.update.mock.calls[0][0].data;
      expect(updateData).not.toHaveProperty("failureCount");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // delete
  // ──────────────────────────────────────────────────────────────────────────

  describe("delete", () => {
    it("throws NotFoundException when webhook not found", async () => {
      mockPrisma.webhookSubscription.findUnique.mockResolvedValue(null);

      await expect(service.delete("user-1", "wh-1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws ForbiddenException when user is not owner", async () => {
      mockPrisma.webhookSubscription.findUnique.mockResolvedValue(
        makeWebhook({ userId: "other-user" }),
      );

      await expect(service.delete("user-1", "wh-1")).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("deletes webhook and returns success", async () => {
      mockPrisma.webhookSubscription.findUnique.mockResolvedValue(
        makeWebhook({ userId: "user-1" }),
      );

      const result = await service.delete("user-1", "wh-1");

      expect(result.success).toBe(true);
      expect(mockPrisma.webhookSubscription.delete).toHaveBeenCalledWith({
        where: { id: "wh-1" },
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // regenerateSecret
  // ──────────────────────────────────────────────────────────────────────────

  describe("regenerateSecret", () => {
    it("throws NotFoundException when webhook not found", async () => {
      mockPrisma.webhookSubscription.findUnique.mockResolvedValue(null);

      await expect(service.regenerateSecret("user-1", "wh-1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws ForbiddenException when user is not owner", async () => {
      mockPrisma.webhookSubscription.findUnique.mockResolvedValue(
        makeWebhook({ userId: "other-user" }),
      );

      await expect(service.regenerateSecret("user-1", "wh-1")).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("generates and returns new secret starting with whsec_", async () => {
      mockPrisma.webhookSubscription.findUnique.mockResolvedValue(
        makeWebhook({ userId: "user-1" }),
      );

      const result = await service.regenerateSecret("user-1", "wh-1");

      expect(result.secret).toMatch(/^whsec_/);
      expect(mockPrisma.webhookSubscription.update).toHaveBeenCalled();
    });

    it("new secret differs from old secret", async () => {
      const oldSecret = "whsec_oldsecret";
      mockPrisma.webhookSubscription.findUnique.mockResolvedValue(
        makeWebhook({ userId: "user-1", secret: oldSecret }),
      );

      const result = await service.regenerateSecret("user-1", "wh-1");

      expect(result.secret).not.toBe(oldSecret);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // getDeliveries
  // ──────────────────────────────────────────────────────────────────────────

  describe("getDeliveries", () => {
    it("throws NotFoundException when webhook not found", async () => {
      mockPrisma.webhookSubscription.findUnique.mockResolvedValue(null);

      await expect(service.getDeliveries("user-1", "wh-1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws ForbiddenException when user is not owner", async () => {
      mockPrisma.webhookSubscription.findUnique.mockResolvedValue(
        makeWebhook({ userId: "other-user" }),
      );

      await expect(service.getDeliveries("user-1", "wh-1")).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("returns deliveries with hasMore=false when results <= limit", async () => {
      mockPrisma.webhookSubscription.findUnique.mockResolvedValue(
        makeWebhook({ userId: "user-1" }),
      );
      const deliveries = Array.from({ length: 3 }, (_, i) => ({
        id: `del-${i}`,
        subscriptionId: "wh-1",
        createdAt: new Date(),
      }));
      mockPrisma.webhookDelivery.findMany.mockResolvedValue(deliveries);

      const result = await service.getDeliveries("user-1", "wh-1", {
        limit: 50,
      });

      expect(result.deliveries).toHaveLength(3);
      expect(result.nextCursor).toBeNull();
    });

    it("returns hasMore=true and nextCursor when results exceed limit", async () => {
      mockPrisma.webhookSubscription.findUnique.mockResolvedValue(
        makeWebhook({ userId: "user-1" }),
      );
      // Simulate limit=2, return 3 (2+1)
      const deliveries = [
        { id: "del-1", subscriptionId: "wh-1", createdAt: new Date() },
        { id: "del-2", subscriptionId: "wh-1", createdAt: new Date() },
        { id: "del-3", subscriptionId: "wh-1", createdAt: new Date() },
      ];
      mockPrisma.webhookDelivery.findMany.mockResolvedValue(deliveries);

      const result = await service.getDeliveries("user-1", "wh-1", {
        limit: 2,
      });

      expect(result.deliveries).toHaveLength(2);
      expect(result.nextCursor).toBe("del-2");
    });

    it("uses cursor for pagination", async () => {
      mockPrisma.webhookSubscription.findUnique.mockResolvedValue(
        makeWebhook({ userId: "user-1" }),
      );
      mockPrisma.webhookDelivery.findMany.mockResolvedValue([]);

      await service.getDeliveries("user-1", "wh-1", {
        limit: 10,
        cursor: "del-5",
      });

      const callArgs = mockPrisma.webhookDelivery.findMany.mock.calls[0][0];
      expect(callArgs.cursor).toEqual({ id: "del-5" });
      expect(callArgs.skip).toBe(1);
    });

    it("defaults limit to 50 when not provided", async () => {
      mockPrisma.webhookSubscription.findUnique.mockResolvedValue(
        makeWebhook({ userId: "user-1" }),
      );
      mockPrisma.webhookDelivery.findMany.mockResolvedValue([]);

      await service.getDeliveries("user-1", "wh-1");

      const callArgs = mockPrisma.webhookDelivery.findMany.mock.calls[0][0];
      expect(callArgs.take).toBe(51); // limit + 1
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // testWebhook
  // ──────────────────────────────────────────────────────────────────────────

  describe("testWebhook", () => {
    it("throws NotFoundException when webhook not found", async () => {
      mockPrisma.webhookSubscription.findUnique.mockResolvedValue(null);

      await expect(service.testWebhook("user-1", "wh-1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws ForbiddenException when user is not owner", async () => {
      mockPrisma.webhookSubscription.findUnique.mockResolvedValue(
        makeWebhook({ userId: "other-user" }),
      );

      await expect(service.testWebhook("user-1", "wh-1")).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("returns success when fetch returns 200", async () => {
      mockPrisma.webhookSubscription.findUnique.mockResolvedValue(
        makeWebhook({ userId: "user-1" }),
      );
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue("OK"),
      });

      const result = await service.testWebhook("user-1", "wh-1");

      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
    });

    it("returns failure when fetch returns 4xx", async () => {
      mockPrisma.webhookSubscription.findUnique.mockResolvedValue(
        makeWebhook({ userId: "user-1" }),
      );
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        text: jest.fn().mockResolvedValue("Not found"),
      });

      const result = await service.testWebhook("user-1", "wh-1");

      expect(result.success).toBe(false);
    });

    it("returns failure when fetch throws (network error)", async () => {
      mockPrisma.webhookSubscription.findUnique.mockResolvedValue(
        makeWebhook({ userId: "user-1" }),
      );
      mockFetch.mockRejectedValue(new Error("Network error"));

      const result = await service.testWebhook("user-1", "wh-1");

      expect(result.success).toBe(false);
      expect((result as { error: string }).error).toBe("Network error");
    });

    it("includes responseTime in successful response", async () => {
      mockPrisma.webhookSubscription.findUnique.mockResolvedValue(
        makeWebhook({ userId: "user-1" }),
      );
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue("OK"),
      });

      const result = await service.testWebhook("user-1", "wh-1");

      expect(typeof (result as { responseTime: number }).responseTime).toBe(
        "number",
      );
    });

    it("truncates responseBody to 1000 characters", async () => {
      mockPrisma.webhookSubscription.findUnique.mockResolvedValue(
        makeWebhook({ userId: "user-1" }),
      );
      const longBody = "x".repeat(2000);
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue(longBody),
      });

      const result = await service.testWebhook("user-1", "wh-1");

      expect((result as { responseBody: string }).responseBody).toHaveLength(
        1000,
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // signPayload
  // ──────────────────────────────────────────────────────────────────────────

  describe("signPayload", () => {
    it("returns HMAC signature in expected format t=...,v1=...", () => {
      const payload = { event: "test", data: { key: "value" } };
      const signature = service.signPayload(payload, "secret-key");

      expect(signature).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);
    });

    it("produces different signatures for different payloads", () => {
      const sig1 = service.signPayload({ a: 1 }, "secret");
      const sig2 = service.signPayload({ a: 2 }, "secret");

      // Signatures differ (timestamp component will be same but payload different)
      expect(sig1).not.toBe(sig2);
    });

    it("produces different signatures for different secrets", () => {
      const payload = { event: "test" };
      const sig1 = service.signPayload(payload, "secret1");
      const sig2 = service.signPayload(payload, "secret2");

      expect(sig1).not.toBe(sig2);
    });
  });
});
