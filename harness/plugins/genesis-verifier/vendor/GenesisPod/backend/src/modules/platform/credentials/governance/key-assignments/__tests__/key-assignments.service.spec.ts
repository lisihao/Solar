import { Test, TestingModule } from "@nestjs/testing";
import { ConflictException, Logger, NotFoundException } from "@nestjs/common";
import { KeyAssignmentsService } from "../key-assignments.service";
import { SecretsService } from "@/modules/platform/credentials/storage/secrets/secrets.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { KeyAssignmentStatus } from "@prisma/client";
import { QuotaExceededError } from "../../../resolution/key-resolver/key-resolver.errors";

/**
 * 2026-05-08 v5（drop_distributable_keys）spec：
 *   - 删除 assign / DistributableKeysService 依赖测试
 *   - 改为测 grantBatch（modelDbId 输入）+ resolveActive 走 AIModel join
 *   - SecretsService 替代 DistributableKeysService 解密
 */

describe("KeyAssignmentsService (v5: drop_distributable_keys)", () => {
  let service: KeyAssignmentsService;
  let prisma: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  let secrets: jest.Mocked<Partial<SecretsService>>;

  const makeAssignment = (overrides: Record<string, unknown> = {}) => ({
    id: "a-1",
    modelDbId: "m-1",
    userId: "u-1",
    provider: "openai",
    modelId: "gpt-4o",
    userQuotaCents: 1000,
    userSpendCents: 0,
    status: KeyAssignmentStatus.ACTIVE,
    validityType: "ONE_TIME",
    recurrenceUnit: null,
    recurrenceInterval: null,
    nextRenewalAt: null,
    assignedAt: new Date(),
    assignedBy: "admin",
    expiresAt: null,
    revokedAt: null,
    revokedBy: null,
    revokedReason: null,
    note: null,
    notifiedExpiringAt: null,
    model: {
      id: "m-1",
      // 2026-05-12 PR-4: AIModel.apiKey 明文列回读已删，BYOK 必须走 secretKey
      apiKey: null,
      apiEndpoint: null,
      secretKey: "OPENAI_BYOK_SECRET",
      isEnabled: true,
      priority: 50,
      displayName: "GPT-4o",
    },
    ...overrides,
  });

  beforeEach(async () => {
    prisma = {
      aIModel: {
        findUnique: jest.fn(),
      },
      keyAssignment: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue(makeAssignment()),
        update: jest.fn().mockResolvedValue(makeAssignment()),
        delete: jest.fn().mockResolvedValue(undefined),
      },
      $transaction: jest.fn().mockImplementation(async (arg) => {
        if (typeof arg === "function") return arg(prisma);
        return Promise.all(arg);
      }),
    };
    secrets = {
      getValueInternal: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KeyAssignmentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: SecretsService, useValue: secrets },
      ],
    }).compile();
    service = module.get(KeyAssignmentsService);
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
  });

  describe("resolveActive", () => {
    it("returns null when no candidates", async () => {
      prisma.keyAssignment.findMany.mockResolvedValueOnce([]);
      expect(await service.resolveActive("u", "openai")).toBeNull();
    });

    it("returns first usable assignment via SecretsService (BYOK 单源)", async () => {
      prisma.keyAssignment.findMany.mockResolvedValueOnce([makeAssignment()]);
      (secrets.getValueInternal as jest.Mock).mockResolvedValueOnce(
        "sk-from-byok-secret",
      );
      const r = await service.resolveActive("u-1", "openai");
      expect(r?.apiKey).toBe("sk-from-byok-secret");
      expect(r?.modelDbId).toBe("m-1");
    });

    it("prefers SecretsService when secretKey is set", async () => {
      prisma.keyAssignment.findMany.mockResolvedValueOnce([
        makeAssignment({
          model: {
            id: "m-1",
            apiKey: "sk-fallback",
            secretKey: "OPENAI_KEY",
            apiEndpoint: null,
            isEnabled: true,
            priority: 50,
          },
        }),
      ]);
      (secrets.getValueInternal as jest.Mock).mockResolvedValueOnce(
        "sk-from-secrets",
      );
      const r = await service.resolveActive("u-1", "openai");
      expect(r?.apiKey).toBe("sk-from-secrets");
    });

    it("marks expired assignment and continues to next", async () => {
      const expired = makeAssignment({
        id: "expired",
        expiresAt: new Date(Date.now() - 1000),
      });
      const fresh = makeAssignment({ id: "fresh" });
      prisma.keyAssignment.findMany.mockResolvedValueOnce([expired, fresh]);
      (secrets.getValueInternal as jest.Mock).mockResolvedValue(
        "sk-from-byok-secret",
      );
      const r = await service.resolveActive("u-1", "openai");
      expect(r?.assignmentId).toBe("fresh");
      expect(prisma.keyAssignment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "expired" },
          data: { status: KeyAssignmentStatus.EXPIRED },
        }),
      );
    });

    it("throws QuotaExceededError when first candidate over quota", async () => {
      prisma.keyAssignment.findMany.mockResolvedValueOnce([
        makeAssignment({ userSpendCents: 1000, userQuotaCents: 1000 }),
      ]);
      await expect(service.resolveActive("u-1", "openai")).rejects.toThrow(
        QuotaExceededError,
      );
    });

    it("skips assignment when model is disabled", async () => {
      prisma.keyAssignment.findMany.mockResolvedValueOnce([
        makeAssignment({
          model: {
            id: "m-1",
            apiKey: "sk-x",
            secretKey: null,
            apiEndpoint: null,
            isEnabled: false,
            priority: 50,
          },
        }),
      ]);
      expect(await service.resolveActive("u-1", "openai")).toBeNull();
    });

    it("returns null when no key resolvable from any candidate", async () => {
      prisma.keyAssignment.findMany.mockResolvedValueOnce([
        makeAssignment({
          model: {
            id: "m-1",
            apiKey: null,
            secretKey: null,
            apiEndpoint: null,
            isEnabled: true,
            priority: 50,
          },
        }),
      ]);
      expect(await service.resolveActive("u-1", "openai")).toBeNull();
    });
  });

  describe("incrementSpend", () => {
    it("no-ops on non-positive cost", async () => {
      await service.incrementSpend("a-1", 0);
      expect(prisma.keyAssignment.update).not.toHaveBeenCalled();
    });

    it("only increments userSpendCents (no pool spend in v5)", async () => {
      await service.incrementSpend("a-1", 150);
      expect(prisma.keyAssignment.update).toHaveBeenCalledWith({
        where: { id: "a-1" },
        data: { userSpendCents: { increment: 150 } },
      });
    });
  });

  describe("revoke", () => {
    it("throws NotFound when assignment missing", async () => {
      prisma.keyAssignment.findUnique.mockResolvedValueOnce(null);
      await expect(service.revoke("missing", "admin")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("sets REVOKED status and records auditor", async () => {
      prisma.keyAssignment.findUnique.mockResolvedValueOnce(makeAssignment());
      await service.revoke("a-1", "admin@ex", "security");
      const call = prisma.keyAssignment.update.mock.calls[0][0];
      expect(call.data.status).toBe(KeyAssignmentStatus.REVOKED);
      expect(call.data.revokedBy).toBe("admin@ex");
      expect(call.data.revokedReason).toBe("security");
    });

    it("idempotent: already-REVOKED returns existing without update", async () => {
      const revoked = makeAssignment({
        status: KeyAssignmentStatus.REVOKED,
      });
      prisma.keyAssignment.findUnique.mockResolvedValueOnce(revoked);
      const r = await service.revoke("a-1", "admin");
      expect(r).toEqual(revoked);
      expect(prisma.keyAssignment.update).not.toHaveBeenCalled();
    });
  });

  describe("getAvailableProviders", () => {
    it("returns distinct provider strings", async () => {
      prisma.keyAssignment.findMany.mockResolvedValueOnce([
        { provider: "openai" },
        { provider: "anthropic" },
      ]);
      const ps = await service.getAvailableProviders("u");
      expect(ps).toEqual(expect.arrayContaining(["openai", "anthropic"]));
    });
  });

  describe("computeNextRenewalAt", () => {
    it("WEEK adds days correctly", () => {
      const from = new Date(2026, 0, 1);
      const next = service.computeNextRenewalAt(from, "WEEK", 2);
      const diffDays = (next.getTime() - from.getTime()) / 86_400_000;
      expect(diffDays).toBe(14);
    });

    it("MONTH from Jan 31 clamps to Feb 28", () => {
      const from = new Date(2026, 0, 31);
      const next = service.computeNextRenewalAt(from, "MONTH", 1);
      expect(next.getMonth()).toBe(1);
      expect(next.getDate()).toBeLessThanOrEqual(28);
    });

    it("MONTH from Jan 31 clamps to Feb 29 in leap year 2028", () => {
      const from = new Date(2028, 0, 31);
      const next = service.computeNextRenewalAt(from, "MONTH", 1);
      expect(next.getMonth()).toBe(1);
      expect(next.getDate()).toBe(29);
    });

    it("YEAR Feb 29 leap → next year Feb 28 clamped", () => {
      const from = new Date(2028, 1, 29);
      const next = service.computeNextRenewalAt(from, "YEAR", 1);
      expect(next.getFullYear()).toBe(2029);
      expect(next.getMonth()).toBe(1);
      expect(next.getDate()).toBe(28);
    });
  });

  describe("grantBatch", () => {
    it("creates one assignment per modelDbId with derived provider/modelId", async () => {
      prisma.aIModel.findUnique
        .mockResolvedValueOnce({
          id: "m-1",
          provider: "OpenAI",
          modelId: "gpt-4o",
          isEnabled: true,
        })
        .mockResolvedValueOnce({
          id: "m-2",
          provider: "Anthropic",
          modelId: "claude-opus-4",
          isEnabled: true,
        });
      prisma.keyAssignment.findUnique.mockResolvedValue(null);
      prisma.keyAssignment.create
        .mockResolvedValueOnce(makeAssignment())
        .mockResolvedValueOnce(makeAssignment({ id: "a-2", modelDbId: "m-2" }));

      const result = await service.grantBatch({
        userId: "u-1",
        models: [
          { modelDbId: "m-1", userQuotaCents: 2000 },
          { modelDbId: "m-2", userQuotaCents: 3000 },
        ],
        validityType: "ONE_TIME",
        expiresAt: new Date("2026-12-31"),
      });

      expect(result.succeeded).toHaveLength(2);
      expect(result.failed).toHaveLength(0);
      // 验证 provider 来自 AIModel 派生（小写）
      const firstCreate = prisma.keyAssignment.create.mock.calls[0][0];
      expect(firstCreate.data.provider).toBe("openai");
    });

    it("partial failure: missing model pushes to failed[]", async () => {
      prisma.aIModel.findUnique
        .mockResolvedValueOnce({
          id: "m-1",
          provider: "OpenAI",
          modelId: "gpt-4o",
          isEnabled: true,
        })
        .mockResolvedValueOnce(null);
      prisma.keyAssignment.findUnique.mockResolvedValue(null);
      prisma.keyAssignment.create.mockResolvedValueOnce(makeAssignment());

      const result = await service.grantBatch({
        userId: "u-1",
        models: [{ modelDbId: "m-1" }, { modelDbId: "ghost" }],
        validityType: "ONE_TIME",
        expiresAt: new Date("2026-12-31"),
      });

      expect(result.succeeded).toHaveLength(1);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].modelDbId).toBe("ghost");
      expect(result.failed[0].reason).toContain("Model not found");
    });

    it("disabled model pushes to failed[]", async () => {
      prisma.aIModel.findUnique.mockResolvedValueOnce({
        id: "m-1",
        provider: "OpenAI",
        modelId: "gpt-4o",
        isEnabled: false,
      });
      const result = await service.grantBatch({
        userId: "u-1",
        models: [{ modelDbId: "m-1" }],
        validityType: "ONE_TIME",
        expiresAt: new Date("2026-12-31"),
      });
      expect(result.succeeded).toHaveLength(0);
      expect(result.failed[0].reason).toContain("disabled");
    });

    it("duplicate ACTIVE assignment pushes to failed[]", async () => {
      prisma.aIModel.findUnique.mockResolvedValueOnce({
        id: "m-1",
        provider: "OpenAI",
        modelId: "gpt-4o",
        isEnabled: true,
      });
      prisma.keyAssignment.findUnique.mockResolvedValue(makeAssignment());
      const result = await service.grantBatch({
        userId: "u-1",
        models: [{ modelDbId: "m-1" }],
        validityType: "ONE_TIME",
        expiresAt: new Date("2026-12-31"),
      });
      expect(result.failed[0].reason).toContain("already has active");
    });

    it("RECURRING without recurrenceUnit/Interval throws ConflictException", async () => {
      await expect(
        service.grantBatch({
          userId: "u-1",
          models: [{ modelDbId: "m-1" }],
          validityType: "RECURRING",
        }),
      ).rejects.toThrow(ConflictException);
    });

    it("RECURRING fills nextRenewalAt + recurrence fields", async () => {
      prisma.aIModel.findUnique.mockResolvedValueOnce({
        id: "m-1",
        provider: "OpenAI",
        modelId: "gpt-4o",
        isEnabled: true,
      });
      prisma.keyAssignment.findUnique.mockResolvedValue(null);
      prisma.keyAssignment.create.mockResolvedValueOnce(makeAssignment());

      await service.grantBatch({
        userId: "u-1",
        models: [{ modelDbId: "m-1" }],
        validityType: "RECURRING",
        recurrenceUnit: "MONTH",
        recurrenceInterval: 1,
      });

      const data = prisma.keyAssignment.create.mock.calls[0][0].data;
      expect(data.validityType).toBe("RECURRING");
      expect(data.recurrenceUnit).toBe("MONTH");
      expect(data.nextRenewalAt).toBeInstanceOf(Date);
      expect(data.expiresAt).toBeNull();
    });

    it("empty models[] returns empty result", async () => {
      const result = await service.grantBatch({
        userId: "u-1",
        models: [],
        validityType: "ONE_TIME",
      });
      expect(result.succeeded).toHaveLength(0);
      expect(result.failed).toHaveLength(0);
    });
  });
});
