import { Test, TestingModule } from "@nestjs/testing";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { KeyRequestsService } from "../key-requests.service";
import { KeyAssignmentsService } from "../../key-assignments/key-assignments.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { KeyRequestStatus } from "@prisma/client";

describe("KeyRequestsService", () => {
  let service: KeyRequestsService;
  let prisma: any;
  let assignments: jest.Mocked<Partial<KeyAssignmentsService>>;

  const makeRequest = (overrides: Record<string, unknown> = {}) => ({
    id: "r-1",
    userId: "u-1",
    provider: null, // 2026-05-08: 用户提交时不再选 provider
    reason: "I need it",
    estimatedUsage: "MEDIUM",
    note: null,
    status: KeyRequestStatus.PENDING,
    handledBy: null,
    handledAt: null,
    rejectionReason: null,
    resultingAssignmentId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(async () => {
    prisma = {
      keyRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(makeRequest()),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue(makeRequest()),
        update: jest.fn().mockResolvedValue(makeRequest()),
        count: jest.fn().mockResolvedValue(0),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue({ email: "u@x.com" }),
      },
      $transaction: jest.fn().mockImplementation(async (fn) => fn(prisma)),
    };
    assignments = {
      grantBatch: jest.fn().mockResolvedValue({
        succeeded: [{ id: "a-1", provider: "openai", modelId: "gpt-4o" }],
        failed: [],
      }),
      revoke: jest.fn().mockResolvedValue({ id: "a-1" }),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KeyRequestsService,
        { provide: PrismaService, useValue: prisma },
        { provide: KeyAssignmentsService, useValue: assignments },
      ],
    }).compile();
    service = module.get(KeyRequestsService);
  });

  describe("create", () => {
    it("rejects invalid estimatedUsage", async () => {
      await expect(
        service.create("u", {
          estimatedUsage: "WRONG" as any,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects when user already has a PENDING request", async () => {
      prisma.keyRequest.findFirst.mockResolvedValueOnce(makeRequest());
      await expect(service.create("u-1", {})).rejects.toThrow(
        ConflictException,
      );
    });

    it("persists with provider=null (admin chooses model at approve time)", async () => {
      await service.create("u-1", {
        reason: "  r  ",
        estimatedUsage: "LIGHT",
      });
      expect(prisma.keyRequest.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: "u-1",
          provider: null,
          reason: "r",
          estimatedUsage: "LIGHT",
        }),
      });
    });
  });

  describe("approve", () => {
    it("throws when request is not PENDING", async () => {
      prisma.keyRequest.findUnique.mockResolvedValueOnce(
        makeRequest({ status: KeyRequestStatus.APPROVED }),
      );
      await expect(
        service.approve("r-1", { modelDbId: "m-1", approvedBy: "admin" }),
      ).rejects.toThrow(ConflictException);
    });

    it("throws BadRequestException when grantBatch returns failed[] (request stays PENDING)", async () => {
      (assignments.grantBatch as jest.Mock).mockResolvedValueOnce({
        succeeded: [],
        failed: [{ modelDbId: "ghost", reason: "Model not found: ghost" }],
      });
      await expect(
        service.approve("r-1", { modelDbId: "ghost", approvedBy: "admin@ex" }),
      ).rejects.toThrow(/Approval failed.*Model not found/);
      // request 仍是 PENDING（update 没被调用切换状态）
      const updateCalls = prisma.keyRequest.update.mock.calls;
      const statusUpdates = updateCalls.filter(
        (c: unknown[]) =>
          (c[0] as { data?: { status?: string } }).data?.status === "APPROVED",
      );
      expect(statusUpdates).toHaveLength(0);
    });

    it("creates assignment via grantBatch and marks request APPROVED", async () => {
      await service.approve("r-1", {
        modelDbId: "m-1",
        userQuotaCents: 500,
        approvedBy: "admin@ex",
      });
      expect(assignments.grantBatch).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: expect.any(String),
          models: [
            expect.objectContaining({
              modelDbId: "m-1",
              userQuotaCents: 500,
            }),
          ],
          validityType: "ONE_TIME",
          assignedBy: "admin@ex",
        }),
      );
      const update = prisma.keyRequest.update.mock.calls[0][0];
      expect(update.data.status).toBe(KeyRequestStatus.APPROVED);
      expect(update.data.resultingAssignmentId).toBe("a-1");
    });
  });

  describe("reject", () => {
    it("requires non-empty reason", async () => {
      await expect(service.reject("r-1", "admin", "")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("throws when request already handled", async () => {
      prisma.keyRequest.findUnique.mockResolvedValueOnce(
        makeRequest({ status: KeyRequestStatus.APPROVED }),
      );
      await expect(service.reject("r-1", "admin", "no")).rejects.toThrow(
        ConflictException,
      );
    });

    it("sets REJECTED with reason and auditor", async () => {
      await service.reject("r-1", "admin@ex", "duplicate");
      const call = prisma.keyRequest.update.mock.calls[0][0];
      expect(call.data.status).toBe(KeyRequestStatus.REJECTED);
      expect(call.data.rejectionReason).toBe("duplicate");
      expect(call.data.handledBy).toBe("admin@ex");
    });
  });

  describe("cancel", () => {
    it("throws NotFound when request belongs to a different user", async () => {
      prisma.keyRequest.findUnique.mockResolvedValueOnce(
        makeRequest({ userId: "other" }),
      );
      await expect(service.cancel("r-1", "u-1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
